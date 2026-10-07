const config = require("./config");

const WINDOW = Math.max(config.agentStaleMs * 4, 60000);
let seenAt = 0;
let state = { minecraft: "offline", playit: "unknown", minecraftPort: false, players: null, maxPlayers: null, uptimeSec: null, lastExit: null, crashed: false, lastStopReason: "none", crashStreak: 0, lastCrashAt: null, logTail: [] };
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
  const independent = new Set(["backup", "backup.cancel", "playit.ensure", "playit.restart", "playit.stop"]);
  if (!independent.has(type) && state.minecraft !== "running") throw new Error("Minecraft is not running");
  return enqueue(type, args);
}
async function waitForAction(id, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  let disconnectedAt = 0;
  while (Date.now() < end) {
    if (!connected()) {
      if (!disconnectedAt) disconnectedAt = Date.now();
      // A busy Codespace/agent can briefly miss a heartbeat. Give it a
      // reconnect grace period instead of declaring the action failed
      // immediately.
      if (Date.now() - disconnectedAt >= Math.min(30000, Math.max(10000, config.agentStaleMs * 2))) {
        throw new Error("SMC agent went offline while completing the action.");
      }
    } else {
      disconnectedAt = 0;
    }
    const result = state.actionResults?.[id] || state.lastActionResult;
    if (result && result.id === id) {
      if (!result.ok) throw new Error(result.error || "Minecraft action failed.");
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for Minecraft to complete the action.");
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
function backup() { return action("backup"); }
function playitEnsure() { return action("playit.ensure"); }
function playitRestart() { return action("playit.restart"); }
function playitStop() { return action("playit.stop"); }
function propertySet(key, value) { return action("property.set", { key, value }); }
module.exports = { authenticated, connected, sync, info, status, setDesired, restart, action, waitForAction, whitelistAdd, whitelistRemove, whitelistClear, kick, ban, pardon, op, deop, say, command, save, backup, playitEnsure, playitRestart, playitStop, propertySet };
