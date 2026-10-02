const cfg = require("./config");
const gh = require("./github");
const agent = require("./agent");

const sleep = ms => new Promise(r => setTimeout(r, ms));
let busy = null;
let lastActionAt = 0;
let idleTimer = null;

function cooldown() {
  const remaining = cfg.actionCooldownMs - (Date.now() - lastActionAt);
  if (remaining > 0) throw new Error(`Please wait ${Math.ceil(remaining / 1000)}s before another SMC action.`);
  lastActionAt = Date.now();
}
async function waitUntil(label, predicate, timeout, progress, interval = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await progress(`${label}…`); await sleep(interval); }
  throw new Error(`Timed out: ${label}`);
}
async function ensureCodespace(progress) {
  let state = await gh.getState();
  if (state === "ShuttingDown") { await progress("Codespace is finishing shutdown…"); await waitUntil("Codespace shutdown", async () => (await gh.getState()) === "Shutdown", cfg.codespaceTimeoutMs, progress); state = "Shutdown"; }
  if (state === "Shutdown" || state === "Archived") { await progress("Starting Codespace…"); await gh.start(); }
  else if (state === "Available") await progress("Codespace is already online.");
  else await progress(`Codespace state: ${state} — waiting…`);
  await waitUntil("Codespace", async () => (await gh.getState()) === "Available", cfg.codespaceTimeoutMs, progress);
}
async function waitForAgent(progress) {
  await waitUntil("SMC agent connection", () => agent.alive(), 180000, async () => {
    const i = agent.info(); await progress(i.lastSeen ? `SMC agent heartbeat age: ${Math.round(i.ageMs / 1000)}s` : "Waiting for SMC agent heartbeat…");
  }, 1500);
}
async function statusSnapshot() {
  const out = { codespace: "offline", agent: "offline", minecraft: "offline", playit: "offline", players: null, max: null, uptimeSec: null, errors: [] };
  try { const state = await gh.getState(); out.codespace = state === "Available" ? "online" : state === "ShuttingDown" ? "stopping" : "offline"; } catch (e) { out.errors.push(e.message); return out; }
  if (out.codespace !== "online") return out;
  if (!agent.alive()) { out.errors.push("SMC agent is offline"); return out; }
  out.agent = "online";
  try { const s = agent.status(); out.minecraft = s.minecraft || "unknown"; out.playit = s.playit || "unknown"; out.players = s.players?.online ?? null; out.max = s.players?.max ?? s.maxPlayers ?? null; out.uptimeSec = s.uptimeSec ?? null; } catch (e) { out.errors.push(e.message); }
  return out;
}
function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  if (cfg.idleMinutes <= 0) return;
  idleTimer = setTimeout(async () => {
    try {
      if (busy || !agent.alive()) return scheduleIdleShutdown();
      const s = agent.status();
      if (s.minecraft !== "running" || (s.players?.online ?? 0) > 0) return scheduleIdleShutdown();
      await stopInternal(async () => {}, false);
    } catch { scheduleIdleShutdown(); }
  }, cfg.idleMinutes * 60000);
}
async function start(progress = async () => {}) {
  if (busy) throw new Error(`SMC is already busy: ${busy}`);
  cooldown(); busy = "start";
  try {
    await ensureCodespace(progress); await waitForAgent(progress);
    if (agent.status().minecraft === "running") return statusSnapshot();
    agent.setDesired("running");
    await progress("Minecraft desired state set to RUNNING. Agent is reconciling…");
    await waitUntil("Minecraft readiness", () => agent.alive() && agent.status().minecraft === "running", cfg.startTimeoutMs, progress, 2000);
    scheduleIdleShutdown(); return statusSnapshot();
  } finally { busy = null; }
}
async function stopInternal(progress, enforceCooldown) {
  if (enforceCooldown) cooldown();
  const state = await gh.getState();
  if (state === "Shutdown" || state === "Archived") { clearTimeout(idleTimer); return { already: true }; }
  if (agent.alive()) {
    try {
      agent.setDesired("stopped"); await progress("Minecraft desired state set to STOPPED. Waiting for graceful shutdown…");
      await waitUntil("Minecraft shutdown", () => !agent.alive() || ["stopped", "unknown"].includes(agent.status().minecraft), cfg.stopTimeoutMs, progress, 1000);
    } catch (e) { await progress(`Graceful stop timed out; Codespace will be stopped now (${e.message}).`); }
  } else await progress("Agent is offline; stopping the Codespace directly.");
  await progress("Stopping Codespace…"); await gh.stop();
  await waitUntil("Codespace shutdown", async () => ["Shutdown", "Archived"].includes(await gh.getState()), cfg.codespaceTimeoutMs, progress, 2000);
  clearTimeout(idleTimer); idleTimer = null; return { stopped: true };
}
async function stop(progress = async () => {}) { if (busy) throw new Error(`SMC is already busy: ${busy}`); busy = "stop"; try { return await stopInternal(progress, true); } finally { busy = null; } }
async function restart(progress = async () => {}) {
  if (busy) throw new Error(`SMC is already busy: ${busy}`);
  cooldown(); busy = "restart";
  try {
    await ensureCodespace(progress); await waitForAgent(progress);
    agent.requestRestart(); await progress("Restart requested. Agent will reconcile Minecraft to a clean RUNNING state…");
    await waitUntil("Minecraft restart", () => agent.alive() && agent.status().minecraft === "running", cfg.startTimeoutMs + cfg.stopTimeoutMs, progress, 2000);
    scheduleIdleShutdown(); return statusSnapshot();
  } finally { busy = null; }
}
module.exports = { statusSnapshot, startServer: start, stopServer: stop, restartServer: restart, whitelistAdd: agent.whitelistAdd, isBusy: () => busy };
