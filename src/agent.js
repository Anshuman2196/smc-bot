const cfg = require("./config");

const queue = [];
const pending = new Map();
let lastSeen = 0;
let lastStatus = null;
let sequence = 0;

function heartbeat(status) {
  lastSeen = Date.now();
  if (status && typeof status === "object") lastStatus = status;
}

function alive() {
  return lastSeen > 0 && Date.now() - lastSeen <= cfg.agentStaleMs;
}

function enqueue(type, args = {}, timeout = cfg.commandTimeoutMs, onProgress = null) {
  if (!alive()) throw new Error("SMC agent is offline");
  if (pending.size > 0 || queue.length > 0) throw new Error("SMC is busy with another operation");

  const id = `${Date.now()}-${++sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`SMC agent timed out while running ${type}`));
    }, timeout);
    pending.set(id, { type, timer, resolve, reject, onProgress });
    queue.push({ id, type, args });
  });
}

function poll(status) {
  heartbeat(status);
  return queue.shift() || null;
}

function result(payload) {
  heartbeat(payload?.status);
  const job = pending.get(payload?.id);
  if (!job) return false;
  pending.delete(payload.id);
  clearTimeout(job.timer);
  if (payload.ok) job.resolve(payload.data || {});
  else job.reject(new Error(payload.error || `${job.type} failed`));
  return true;
}

function progress(payload) {
  heartbeat(payload?.status || payload?.data?.status);
  const job = pending.get(payload?.id);
  if (!job) return false;
  if (typeof job.onProgress === "function") job.onProgress(String(payload.message || "Working…"), payload.data || null);
  return true;
}

function auth(req) {
  return req.headers.authorization === `Bearer ${cfg.agentToken}`;
}

function info() {
  return {
    online: alive(),
    lastSeen,
    ageMs: lastSeen ? Date.now() - lastSeen : null,
    queued: queue.length,
    pending: pending.size,
    status: lastStatus
  };
}

function status() {
  if (!alive()) throw new Error("SMC agent is offline");
  return lastStatus || { minecraft: "unknown", playit: "unknown" };
}

module.exports = {
  auth, poll, result, progress, heartbeat, alive, info, status,
  start: onProgress => enqueue("minecraft.start", {}, cfg.startTimeoutMs, onProgress),
  stop: onProgress => enqueue("minecraft.stop", {}, cfg.stopTimeoutMs, onProgress),
  restart: onProgress => enqueue("minecraft.restart", {}, cfg.startTimeoutMs + cfg.stopTimeoutMs, onProgress),
  players: () => enqueue("players", {}, cfg.commandTimeoutMs),
  whitelistAdd: name => enqueue("whitelist.add", { name }, cfg.commandTimeoutMs)
};
