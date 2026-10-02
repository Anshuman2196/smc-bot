const config = require("./config");

const WINDOW = Math.max(config.agentStaleMs * 2, 30000);
let seenAt = 0;
let state = { minecraft: "offline", playit: "unknown", minecraftPort: false, players: null, maxPlayers: null, uptimeSec: null, lastExit: null, logTail: [] };
let desired = "stopped";
let generation = 0;
const queue = [];

const connected = () => seenAt > 0 && Date.now() - seenAt <= WINDOW;
const authenticated = req => req.headers.authorization === `Bearer ${config.agentToken}`;
function accept(status) {
  seenAt = Date.now();
  if (status && typeof status === "object") state = { ...state, ...status };
}
function setDesired(value) { if (!["running", "stopped"].includes(value)) throw new Error("Invalid Minecraft desired state"); desired = value; }
function restart() { desired = "running"; generation += 1; return generation; }
function enqueue(type, args) { const item = { id: `${Date.now()}-${queue.length + 1}`, type, args, createdAt: Date.now() }; queue.push(item); return item; }
function sync(status) { accept(status); return { desiredMinecraft: desired, restartGeneration: generation, action: queue.shift() || null }; }
function info() { return { connected: connected(), ageMs: seenAt ? Date.now() - seenAt : null, desiredMinecraft: desired, restartGeneration: generation, state }; }
function status() { if (!connected()) throw new Error("SMC agent is offline"); return state; }
function action(type, args = {}) {
  if (!connected()) throw new Error("SMC agent is offline");
  if (state.minecraft !== "running") throw new Error("Minecraft is not running");
  return enqueue(type, args);
}
function whitelistAdd(name) { return action("whitelist.add", { name }); }
function whitelistRemove(name) { return action("whitelist.remove", { name }); }
function whitelistClear() { return action("whitelist.clear"); }
function kick(name) { return action("kick", { name }); }
function ban(name) { return action("ban", { name }); }
function pardon(name) { return action("pardon", { name }); }
function op(name) { return action("op", { name }); }
function deop(name) { return action("deop", { name }); }
function say(message) { return action("say", { message }); }
function command(command) { return action("command", { command }); }
function save() { return action("save"); }
function seed() { return action("seed"); }
function tps() { return action("tps"); }
function version() { return action("version"); }
module.exports = { authenticated, connected, sync, info, status, setDesired, restart, action, whitelistAdd, whitelistRemove, whitelistClear, kick, ban, pardon, op, deop, say, command, save, seed, tps, version };
