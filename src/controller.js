const c = require("./config");
const gh = require("./github");
const agent = require("./agent");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let busy = null;
let lastActionAt = 0;
let idleTimer = null;
function throttle() { const remaining = c.actionCooldownMs - (Date.now() - lastActionAt); if (remaining > 0) throw new Error(`Please slow down — wait ${Math.ceil(remaining / 1000)}s before trying again.`); lastActionAt = Date.now(); }
async function waitFor(label, fn, timeout, progress = () => {}, interval = 2000) {
  const started = Date.now(), end = started + timeout; let lastProgress = -1;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch {}
    const elapsed = Math.floor((Date.now() - started) / 1000);
    if (elapsed !== lastProgress) { lastProgress = elapsed; await progress(`${label} (${elapsed}s)`); }
    await sleep(interval);
  }
  throw new Error(`Timed out: ${label}`);
}
function scheduleIdleShutdown() { clearTimeout(idleTimer); if (c.idleMinutes <= 0) return; idleTimer = setTimeout(async () => { idleTimer = null; if (busy) return scheduleIdleShutdown(); try { if (await gh.getState() !== "Available" || !agent.alive()) return scheduleIdleShutdown(); const s = await agent.status(); if (s.minecraft !== "running") return scheduleIdleShutdown(); const p = await agent.players(); if (p.online > 0) return scheduleIdleShutdown(); await stopInternal(() => {}, false); } catch { scheduleIdleShutdown(); } }, c.idleMinutes * 60 * 1000); }
async function snapshot() { const result = { codespace: "offline", mc: "offline", playit: "offline", players: null, max: null, uptimeSec: null, errors: [] }; try { const state = await gh.getState(); result.codespace = ({ Available: "online", Shutdown: "offline", ShuttingDown: "stopping" }[state] || "starting"); } catch (e) { result.errors.push(e.message); return result; } if (result.codespace !== "online") return result; if (!agent.alive()) { result.errors.push("SMC agent is not connected"); return result; } try { const s = await agent.status(); result.mc = ({ stopped: "offline", starting: "starting", running: "running", stopping: "stopping" }[s.minecraft] || "unknown"); result.playit = s.playit === "connected" ? "connected" : s.playit === "starting" ? "starting" : "offline"; result.max = s.maxPlayers; result.uptimeSec = s.uptimeSec; if (result.mc === "running") { try { const p = await agent.players(); result.players = p.online; result.max = p.max; } catch (e) { result.errors.push(e.message); } } } catch (e) { result.errors.push(e.message); } return result; }
async function ensureCodespace(progress) { let state = await gh.getState(); if (state === "ShuttingDown") { await waitFor("Waiting for Codespace", async () => (await gh.getState()) === "Shutdown", c.codespaceTimeoutMs, progress); state = "Shutdown"; } if (state === "Shutdown" || state === "Archived") { await progress("Resuming Codespace…"); await gh.start(); } else if (state === "Available") await progress("Codespace already online — checking SMC agent…"); else await progress("Waiting for Codespace…"); await waitFor("Waiting for Codespace", async () => (await gh.getState()) === "Available", c.codespaceTimeoutMs, progress); }
async function startMinecraft(progress = async () => {}) {
  await waitFor("Waiting for SMC agent", () => agent.alive(), 300000, progress, 1500);
  const current = await agent.status();
  if (current.minecraft !== "running" && current.minecraft !== "starting") { await progress("Sending Minecraft start command…"); await agent.startMinecraft(progress); }
  else if (current.minecraft === "starting") await progress("Minecraft is already starting…");
  await waitFor("Waiting for Minecraft", async () => (await agent.status()).minecraft === "running", 420000, progress, 2500);
  const s = await agent.status();
  if (s.playit !== "connected") { await progress("Waiting for Playit tunnel…"); await waitFor("Waiting for Playit tunnel", async () => (await agent.status()).playit === "connected", 120000, progress, 2500); }
}
async function start(progress = async () => {}) { if (busy) throw new Error(`Another operation is in progress: ${busy}`); throttle(); busy = "start"; try { await ensureCodespace(progress); await startMinecraft(progress); scheduleIdleShutdown(); return snapshot(); } finally { busy = null; } }
async function restart(progress = async () => {}) { if (busy) throw new Error(`Another operation is in progress: ${busy}`); throttle(); busy = "restart"; try { await ensureCodespace(progress); await waitFor("Waiting for SMC agent", () => agent.alive(), 300000, progress, 1500); if ((await agent.status()).minecraft !== "stopped") { await progress("Stopping Minecraft…"); await agent.stopMinecraft(progress); await waitFor("Waiting for Minecraft to stop", async () => (await agent.status()).minecraft === "stopped", 30000, progress, 1000); } await startMinecraft(progress); scheduleIdleShutdown(); return snapshot(); } finally { busy = null; } }
async function stopInternal(progress = async () => {}, enforceCooldown = true) { if (enforceCooldown) throttle(); if (await gh.getState() !== "Available") return { already: true }; if (agent.alive()) { try { const s = await agent.status(); if (s.minecraft !== "stopped" && s.minecraft !== "stopping") { await progress("Stopping Minecraft…"); await agent.stopMinecraft(progress); } } catch {} } await progress("Stopping Codespace…"); await gh.stop(); clearTimeout(idleTimer); idleTimer = null; return { already: false, stopping: true }; }
async function stop(progress = async () => {}) { if (busy) throw new Error(`Another operation is in progress: ${busy}`); busy = "stop"; try { return await stopInternal(progress, true); } finally { busy = null; } }
module.exports = { snapshot, startServer: start, stopServer: stop, restartServer: restart, whitelistAdd: agent.whitelistAdd, isBusy: () => busy, overall: s => s.mc === "unknown" ? "error" : s.codespace === "offline" ? "offline" : s.mc === "running" && s.playit === "connected" ? "online" : "starting" };
