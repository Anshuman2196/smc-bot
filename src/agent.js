const cfg = require("./config");

const queue = [];
const pending = new Map();
const waiters = new Set();
let lastSeen = 0;
let sequence = 1;

function heartbeat() { lastSeen = Date.now(); }
function alive(maxAge = cfg.agentStaleMs) { return lastSeen > 0 && Date.now() - lastSeen <= maxAge; }

function enqueue(type, args = {}, timeout = cfg.commandTimeoutMs) {
  const id = `${Date.now()}-${sequence++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`SMC agent did not respond to ${type}`));
    }, timeout);
    pending.set(id, { resolve, reject, timer, type });
    queue.push({ id, type, args });
    wake();
  });
}

function wake() {
  while (queue.length && waiters.size) {
    const waiter = waiters.values().next().value;
    waiters.delete(waiter);
    waiter(queue.shift());
  }
}

function poll() {
  heartbeat();
  if (queue.length) return Promise.resolve(queue.shift());
  return new Promise(resolve => {
    const waiter = value => {
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      resolve(value);
    };
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      resolve({});
    }, cfg.pollWaitMs);
    waiters.add(waiter);
  });
}

function result(payload) {
  heartbeat();
  const job = payload && pending.get(payload.id);
  if (!job) return false;
  pending.delete(payload.id);
  clearTimeout(job.timer);
  if (payload.ok) job.resolve(payload.data);
  else job.reject(new Error(payload.error || `${job.type} failed`));
  return true;
}

function auth(req) { return req.headers.authorization === `Bearer ${cfg.agentToken}`; }
function queueInfo() { return { queued: queue.length, pending: pending.size, alive: alive() }; }

module.exports = {
  auth, poll, result, heartbeat, alive, queueInfo,
  status: () => enqueue("status", {}, cfg.statusTimeoutMs),
  players: () => enqueue("players", {}, cfg.commandTimeoutMs),
  startMinecraft: () => enqueue("minecraft.start", {}, cfg.startTimeoutMs),
  stopMinecraft: () => enqueue("minecraft.stop", {}, cfg.stopTimeoutMs),
  startPlayit: () => enqueue("playit.start", {}, cfg.commandTimeoutMs),
  whitelistAdd: name => enqueue("whitelist.add", { name }, cfg.commandTimeoutMs)
};
