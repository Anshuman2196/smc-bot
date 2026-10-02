const config = require("./config");

const HEARTBEAT_WINDOW = Math.max(config.agentStaleMs, config.pollWaitMs * 2);

let snapshot = {
  minecraft: "unknown",
  playit: "unknown",
  minecraftPort: false,
  players: null,
  maxPlayers: null,
  uptimeSec: null,
  lastExit: null,
  logTail: []
};
let seenAt = 0;
let desiredMinecraft = "unknown";
let restartGeneration = 0;
let actionSequence = 0;
const actions = new Map();

function authenticated(request) {
  return request.headers.authorization === `Bearer ${config.agentToken}`;
}

function connected() {
  return seenAt > 0 && Date.now() - seenAt <= HEARTBEAT_WINDOW;
}

function update(status) {
  seenAt = Date.now();
  if (status && typeof status === "object") snapshot = { ...snapshot, ...status };
  if (desiredMinecraft === "unknown") {
    desiredMinecraft = ["running", "starting", "stopping"].includes(snapshot.minecraft) ? "running" : "stopped";
  }
}

function requestStart() {
  desiredMinecraft = "running";
}

function requestStop() {
  desiredMinecraft = "stopped";
}

function requestRestart() {
  desiredMinecraft = "running";
  restartGeneration += 1;
  return restartGeneration;
}

function queueAction(type, args = {}) {
  const id = `${Date.now()}-${++actionSequence}`;
  actions.set(id, { id, type, args, createdAt: Date.now() });
  return id;
}

function takeAction() {
  const first = actions.values().next();
  if (first.done) return null;
  actions.delete(first.value.id);
  return first.value;
}

function sync(status) {
  update(status);
  return { desiredMinecraft, restartGeneration, action: takeAction() };
}

function info() {
  return {
    connected: connected(),
    seenAt,
    ageMs: seenAt ? Date.now() - seenAt : null,
    desiredMinecraft,
    restartGeneration,
    snapshot
  };
}

function status() {
  if (!connected()) throw new Error("SMC agent is offline");
  return snapshot;
}

function whitelistAdd(name) {
  if (!connected()) throw new Error("SMC agent is offline");
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error("Invalid Minecraft username");
  const id = queueAction("whitelist.add", { name });
  return { id, name };
}

module.exports = { authenticated, connected, sync, info, status, requestStart, requestStop, requestRestart, whitelistAdd };
