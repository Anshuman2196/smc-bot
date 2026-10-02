const config = require("./config");
const github = require("./github");
const agent = require("./agent");

let operation = null;
let lastAction = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function cooldown() { const left = config.actionCooldownMs - (Date.now() - lastAction); if (left > 0) throw new Error(`Please wait ${Math.ceil(left / 1000)}s before another SMC action.`); lastAction = Date.now(); }
async function waitFor(label, fn, timeout, report, interval = 1500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await report(label); await sleep(interval); }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function ensureCodespace(report) {
  let state = await github.state();
  if (state === "ShuttingDown") await waitFor("previous Codespace shutdown", async () => ["Shutdown", "Archived"].includes(await github.state()), config.codespaceTimeoutMs, report, 2000);
  state = await github.state();
  if (["Shutdown", "Archived"].includes(state)) { await report("Starting Codespace…"); await github.start(); }
  await waitFor("Codespace", async () => (await github.state()) === "Available", config.codespaceTimeoutMs, report, 2000);
}
async function ensureAgent(report) {
  await waitFor("SMC agent", () => agent.connected(), config.startTimeoutMs, async () => {
    const i = agent.info();
    await report(i.ageMs == null ? "Waiting for the SMC agent to connect…" : `Agent heartbeat ${Math.ceil(i.ageMs / 1000)}s ago…`);
  }, 1500);
}
async function liveStatus() {
  const result = { codespace: "offline", agent: "offline", minecraft: "offline", playit: "offline", publicAddress: null, players: null, maxPlayers: null, uptimeSec: null, whitelist: [], error: null };
  try { const s = await github.state(); result.codespace = s === "Available" ? "online" : s === "ShuttingDown" ? "stopping" : "offline"; } catch (e) { result.error = e.message; return result; }
  if (result.codespace !== "online") return result;
  if (!agent.connected()) return result;
  result.agent = "online";
  try { const s = agent.status(); Object.assign(result, { minecraft: s.minecraft || "unknown", playit: s.playit || "unknown", publicAddress: s.publicAddress || null, players: s.players?.online ?? null, maxPlayers: s.players?.max ?? s.maxPlayers ?? null, uptimeSec: s.uptimeSec ?? null, whitelist: Array.isArray(s.whitelist) ? s.whitelist : [] }); } catch (e) { result.error = e.message; }
  return result;
}
async function startServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`); cooldown(); operation = "starting";
  try {
    agent.setDesired("running");
    await report("Minecraft desired state set to RUNNING.");
    await ensureCodespace(report);
    await ensureAgent(report);
    await waitFor("Minecraft", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000);
    return liveStatus();
  } finally { operation = null; }
}
async function stopServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  cooldown(); operation = "stopping";
  try {
    if ((await github.state()) !== "Available") return { stopped: true };
    if (!agent.connected()) throw new Error("SMC agent is offline; I can’t verify whether players are online.");
    const current = agent.status();
    const online = current.players?.online;
    if (online == null) throw new Error("I can’t verify the player count yet. Try again in a few seconds.");
    if (online > 0) throw new Error(`The server has ${online} player${online === 1 ? "" : "s"} online. SMC will not stop it until everyone leaves.`);
    agent.setDesired("stopped");
    await report("No players are online. Shutting Minecraft down cleanly.");
    await waitFor("Minecraft shutdown", async () => !agent.connected() || ["stopped", "offline"].includes(agent.status().minecraft), config.stopTimeoutMs, report, 1000);
    await report("Minecraft is empty and stopped. Stopping Codespace…");
    await github.stop();
    await waitFor("Codespace shutdown", async () => ["Shutdown", "Archived"].includes(await github.state()), config.codespaceTimeoutMs, report, 2000);
    return { stopped: true };
  } finally { operation = null; }
}
async function restartServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`); cooldown(); operation = "restarting";
  try {
    agent.setDesired("running");
    await ensureCodespace(report);
    await ensureAgent(report);
    agent.restart();
    await waitFor("Minecraft restart", () => agent.status().minecraft === "running", config.startTimeoutMs + config.stopTimeoutMs, report, 2000);
    return liveStatus();
  } finally { operation = null; }
}
function formatOnline(s) {
  if (s.minecraft !== "running") return "🌙 **Minecraft is offline.**\nThere is nobody online because the server is not running.";
  const p=s.players;
  if (!p || p.online == null) return "⚠️ **Player list is not available yet.**\nTry again in a few seconds.";
  if (!p.online) return "🟢 **Nobody is online right now.**\nThe server is empty.";
  return `🟢 **${p.online} player${p.online===1?"":"s"} online**\n${p.players?.length ? p.players.map(x=>`• ${x}`).join("\n") : "Player names are not available yet."}`;
}
function formatWhitelist(s) {
  const list=s.whitelist||[];
  if (!list.length) return "📋 **Whitelist is empty.**\nWhitelist enforcement is currently **OFF**.";
  return `📋 **Whitelisted players (${list.length})**\n${list.map(x=>`• ${x}`).join("\n")}\n\nWhitelist enforcement is currently **OFF**.`;
}
module.exports = { liveStatus, startServer, stopServer, restartServer, formatOnline, formatWhitelist, operation: () => operation };
