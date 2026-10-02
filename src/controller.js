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
  const result = { codespace: "offline", agent: "offline", minecraft: "offline", playit: "offline", publicAddress: null, players: null, maxPlayers: null, uptimeSec: null, error: null };
  try { const s = await github.state(); result.codespace = s === "Available" ? "online" : s === "ShuttingDown" ? "stopping" : "offline"; } catch (e) { result.error = e.message; return result; }
  if (result.codespace !== "online") return result;
  if (!agent.connected()) return result;
  result.agent = "online";
  try { const s = agent.status(); Object.assign(result, { minecraft: s.minecraft || "unknown", playit: s.playit || "unknown", publicAddress: s.publicAddress || null, players: s.players?.online ?? null, maxPlayers: s.players?.max ?? s.maxPlayers ?? null, uptimeSec: s.uptimeSec ?? null }); } catch (e) { result.error = e.message; }
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
  if (operation) throw new Error(`SMC is already ${operation}.`); cooldown(); operation = "stopping";
  try {
    agent.setDesired("stopped");
    await report("Minecraft desired state set to STOPPED.");
    if ((await github.state()) !== "Available") return { stopped: true };
    if (agent.connected()) {
      try { await waitFor("Minecraft shutdown", async () => !agent.connected() || ["stopped", "offline"].includes(agent.status().minecraft), config.stopTimeoutMs, report, 1000); } catch (e) { await report(`Graceful Minecraft stop window ended: ${e.message}`); }
    } else await report("Agent is offline; proceeding with Codespace shutdown.");
    await report("Stopping Codespace…");
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
function whitelistAdd(name) { return agent.whitelistAdd(name); }
module.exports = { liveStatus, startServer, stopServer, restartServer, whitelistAdd, operation: () => operation };
