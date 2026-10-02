const cfg = require("./config");
const gh = require("./github");
const agent = require("./agent");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await progress(`${label}…`);
    await sleep(interval);
  }
  throw new Error(`Timed out: ${label}`);
}

async function ensureCodespace(progress) {
  let state = await gh.getState();
  if (state === "ShuttingDown") {
    await progress("Codespace is shutting down — waiting for it to finish…");
    await waitUntil("Codespace shutdown", async () => (await gh.getState()) === "Shutdown", cfg.codespaceTimeoutMs, progress);
    state = "Shutdown";
  }
  if (state === "Shutdown" || state === "Archived") {
    await progress("Starting Codespace…");
    await gh.start();
  } else if (state === "Available") {
    await progress("Codespace already online — waiting for SMC agent heartbeat…");
  } else {
    await progress(`Codespace state: ${state} — waiting…`);
  }
  await waitUntil("Codespace", async () => (await gh.getState()) === "Available", cfg.codespaceTimeoutMs, progress);
}

async function waitForAgent(progress) {
  await waitUntil("SMC agent connection", () => agent.alive(), 180000, async () => {
    const info = agent.info();
    await progress(info.lastSeen ? `SMC agent heartbeat age: ${Math.round(info.ageMs / 1000)}s` : "Waiting for SMC agent heartbeat…");
  }, 1500);
}

async function statusSnapshot() {
  const out = { codespace: "offline", agent: "offline", minecraft: "offline", playit: "offline", players: null, max: null, uptimeSec: null, errors: [] };
  try {
    const state = await gh.getState();
    out.codespace = state === "Available" ? "online" : state === "ShuttingDown" ? "stopping" : "offline";
  } catch (e) { out.errors.push(e.message); return out; }
  if (out.codespace !== "online") return out;
  if (!agent.alive()) { out.errors.push("SMC agent is offline"); return out; }
  out.agent = "online";
  try {
    const s = agent.status();
    out.minecraft = s.minecraft || "unknown";
    out.playit = s.playit || "unknown";
    out.max = s.maxPlayers ?? null;
    out.uptimeSec = s.uptimeSec ?? null;
    if (out.minecraft === "running") {
      try { const p = await agent.players(); out.players = p.online; out.max = p.max; }
      catch (e) { out.errors.push(`Players: ${e.message}`); }
    }
  } catch (e) { out.errors.push(e.message); }
  return out;
}

function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  if (cfg.idleMinutes <= 0) return;
  idleTimer = setTimeout(async () => {
    try {
      if (busy || (await gh.getState()) !== "Available" || !agent.alive()) return scheduleIdleShutdown();
      const s = agent.status();
      if (s.minecraft !== "running") return scheduleIdleShutdown();
      const p = await agent.players();
      if (p.online > 0) return scheduleIdleShutdown();
      await stopInternal(async () => {}, false);
    } catch { scheduleIdleShutdown(); }
  }, cfg.idleMinutes * 60000);
}

async function start(progress = async () => {}) {
  if (busy) throw new Error(`SMC is already busy: ${busy}`);
  cooldown(); busy = "start";
  try {
    await ensureCodespace(progress);
    await waitForAgent(progress);
    const s = agent.status();
    if (s.minecraft === "running" && s.playit === "connected") return statusSnapshot();
    await progress("Sending Minecraft start command to the Codespace agent…");
    await agent.start(progress);
    await progress("Minecraft and Playit are ready. Finalizing status…");
    scheduleIdleShutdown();
    return statusSnapshot();
  } finally { busy = null; }
}

async function stopInternal(progress, enforceCooldown) {
  if (enforceCooldown) cooldown();
  if ((await gh.getState()) !== "Available") return { already: true };
  if (agent.alive()) {
    try {
      const s = agent.status();
      if (s.minecraft !== "stopped") await agent.stop(progress);
    } catch (e) { await progress(`Agent stop warning: ${e.message}`); }
  }
  await progress("Stopping Codespace…");
  await gh.stop();
  clearTimeout(idleTimer); idleTimer = null;
  return { stopping: true };
}

async function stop(progress = async () => {}) {
  if (busy) throw new Error(`SMC is already busy: ${busy}`);
  busy = "stop";
  try { return await stopInternal(progress, true); }
  finally { busy = null; }
}

async function restart(progress = async () => {}) {
  if (busy) throw new Error(`SMC is already busy: ${busy}`);
  cooldown(); busy = "restart";
  try {
    await ensureCodespace(progress);
    await waitForAgent(progress);
    const s = agent.status();
    if (s.minecraft !== "stopped") { await progress("Stopping Minecraft…"); await agent.stop(progress); }
    await progress("Minecraft stopped. Starting a clean instance…");
    await agent.start(progress);
    scheduleIdleShutdown();
    return statusSnapshot();
  } finally { busy = null; }
}

module.exports = {
  statusSnapshot,
  startServer: start,
  stopServer: stop,
  restartServer: restart,
  whitelistAdd: agent.whitelistAdd,
  isBusy: () => busy
};
