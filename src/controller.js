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
  const result = { codespace: "offline", agent: "offline", minecraft: "offline", processAlive: false, playit: "offline", publicAddress: null, players: null, maxPlayers: null, uptimeSec: null, crashed: false, lastActionResult: null, lastStopReason: "none", crashStreak: 0, lastCrashAt: null, lastExit: null, whitelist: [], error: null };
  try { const s = await github.state(); result.codespace = s === "Available" ? "online" : s === "ShuttingDown" ? "stopping" : "offline"; } catch (e) { result.error = e.message; return result; }
  if (result.codespace !== "online") return result;
  if (!agent.connected()) return result;
  result.agent = "online";
  try { const s = agent.status(); Object.assign(result, { minecraft: s.minecraft || "unknown", processAlive: Boolean(s.processAlive), playit: s.playit || "unknown", publicAddress: s.publicAddress || null, minecraftPort: Boolean(s.minecraftPort), crashed: Boolean(s.crashed), lastStopReason: s.lastStopReason || "none", crashStreak: s.crashStreak || 0, lastCrashAt: s.lastCrashAt || null, lastExit: s.lastExit ?? null, lastActionResult: s.lastActionResult || null, logTail: Array.isArray(s.logTail) ? s.logTail : [], players: s.players || null, maxPlayers: s.players?.max ?? s.maxPlayers ?? null, uptimeSec: s.uptimeSec ?? null, whitelist: Array.isArray(s.whitelist) ? s.whitelist : [], serverProperties: s.serverProperties || {} }); } catch (e) { result.error = e.message; }
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
async function recoverServer(report = async () => {}) {
  if (operation) return liveStatus();
  if (agent.info().desiredMinecraft !== "running") return liveStatus();

  const state = await github.state();
  if (state !== "Available") {
    operation = "recovering";
    try {
      await report("Minecraft is still expected to be running. Recovering the Codespace…");
      await ensureCodespace(report);
      await ensureAgent(report);
      await waitFor("Minecraft recovery", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000);
      return liveStatus();
    } finally {
      operation = null;
    }
  }

  if (!agent.connected()) {
    operation = "recovering";
    try {
      await report("Codespace is online, but the SMC agent is offline. Waiting for recovery…");
      await ensureAgent(report);
      await waitFor("Minecraft recovery", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000);
      return liveStatus();
    } finally {
      operation = null;
    }
  }

  const current = agent.status();
  if (current.minecraft !== "running") {
    operation = "recovering";
    try {
      // A heartbeat/ready-state hiccup must never become an unsolicited
      // Minecraft restart. The agent now reports the actual process state.
      if (current.processAlive) {
        await report("Minecraft process is still alive. Waiting for it to become ready…");
        await waitFor("Minecraft recovery", () => agent.status().minecraft === "running" || !agent.status().processAlive, Math.min(30000, config.startTimeoutMs), report, 2000);
      }

      const afterWait = agent.status();
      if (afterWait.minecraft !== "running") {
        await report("Minecraft process is not running. Starting it without a forced restart…");
        agent.setDesired("running");
        await waitFor("Minecraft recovery", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000);
      }
    } finally {
      operation = null;
    }
  }

  return liveStatus();
}
async function restartServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`); cooldown(); operation = "restarting";
  try {
    if ((await github.state()) === "Available" && agent.connected()) {
      const current = agent.status();
      if (current.minecraft === "running") {
        const online = current.players?.online;
        if (online == null) throw new Error("I can’t verify the player count yet. Try again in a few seconds.");
        if (online > 0) throw new Error(`The server has ${online} player${online === 1 ? "" : "s"} online. Safe restart waits until everyone leaves.`);
      }
    }
    agent.setDesired("running");
    await ensureCodespace(report);
    await ensureAgent(report);
    agent.restart();
    await waitFor("Minecraft restart", () => agent.status().minecraft === "running", config.startTimeoutMs + config.stopTimeoutMs, report, 2000);
    return liveStatus();
  } finally { operation = null; }
}
function formatOnline(s) {
  if (s.minecraft !== "running") return "⚫ **Minecraft is offline**\n\nThere are no players online right now.";
  const p = s.players;
  if (!p || p.online == null) return "⚪ **Player list unavailable**\n\nTry again in a moment.";
  if (!p.online) return "🟢 **No players online**\n\nThe server is ready for someone to join.";
  return [
    `🟢 **${p.online} player${p.online === 1 ? "" : "s"} online**`,
    "",
    "👥 **Players**\n" + (p.players?.length ? p.players.map(x => `• ${x}`).join("\n") : "Player names are not available yet.")
  ].join("\n");
}

function formatWhitelist(s) {
  const list = s.whitelist || [];
  return [
    "**Smarties • Whitelist**",
    "",
    "👥 **Players**\n" + (list.length ? list.map(x => `• ${x}`).join("\n") : "No players listed."),
    "",
    "🛡️ **Enforcement** — off"
  ].join("\n");
}

async function requireLive() {
  const s = await liveStatus();
  if (s.agent !== "online") throw new Error("SMC agent is offline.");
  if (s.minecraft !== "running") throw new Error("Minecraft is not running.");
  return s;
}

async function minecraftAction(fn, args) {
  await requireLive();
  const item = fn(...(args || []));
  return agent.waitForAction(item.id);
}

function formatHealth(s) {
  const p = s.players;
  return [
    "**Smarties • System Health**",
    "",
    `${s.minecraft === "running" ? "🟢" : "⚫"} **Minecraft** — ${s.minecraft}`,
    `${s.codespace === "online" ? "🟢" : "⚫"} **Codespace** — ${s.codespace}`,
    `${s.agent === "online" ? "🟢" : "⚫"} **Agent** — ${s.agent}`,
    `${s.playit === "online" ? "🟢" : "⚫"} **Playit** — ${s.playit}`,
    `🔌 **Port** — ${s.minecraftPort ? "open" : "closed"}`,
    `👥 **Players** — ${p?.online ?? "—"} / ${p?.max ?? s.maxPlayers ?? "—"}`,
    `⏱️ **Uptime** — ${s.uptimeSec == null ? "—" : Math.floor(s.uptimeSec / 60) + "m " + s.uptimeSec % 60 + "s"}`,
    `🌐 **Address** — ${s.publicAddress ? "\`" + s.publicAddress + "\`" : "not available"}`,
    s.error ? `⚠️ **Error** — ${s.error}` : "✅ **No errors reported**"
  ].join("\n");
}

function formatLogs(s) {
  const lines = s?.logTail || [];
  if (!lines.length) return "📜 **No recent Minecraft logs**\nThere are no log lines available right now.";
  return "📜 **Recent Minecraft logs**\nHere are the latest available lines.\n```\n" + lines.slice(-20).join("\n").slice(-3800) + "\n```";
}

function formatCrash(s) {
  if (!s.crashed) return "🟢 **Minecraft looks healthy**\n\nThere is no active crash to report.";
  const code = s.lastExit == null ? "unknown" : s.lastExit;
  return "🚨 **Minecraft crashed**\n\n" +
    "💥 **Exit code** — \`" + code + "\`\n" +
    "🔁 **Crash streak** — " + (s.crashStreak || 1) + "\n" +
    "📜 **Recent log output**\n```\n" +
    (s.logTail || []).slice(-15).join("\n").slice(-3000) + "\n```";
}

function formatAddress(s) {
  return s.publicAddress
    ? "🌐 **Smarties • Minecraft address**\n\n`" + s.publicAddress + "`\n\n🔗 **Playit** — " + s.playit
    : "🌐 **Playit address unavailable**\nStart Minecraft and wait for the tunnel to connect.";
}
module.exports = {
  liveStatus, startServer, stopServer, restartServer, recoverServer, formatOnline, formatWhitelist, formatHealth, formatLogs, formatCrash, formatAddress,
  operation: () => operation,
  kick: name => minecraftAction(agent.kick, [name]), ban: name => minecraftAction(agent.ban, [name]), pardon: name => minecraftAction(agent.pardon, [name]),
  op: name => minecraftAction(agent.op, [name]), deop: name => minecraftAction(agent.deop, [name]),
  whitelistAdd: name => minecraftAction(agent.whitelistAdd, [name]), whitelistRemove: name => minecraftAction(agent.whitelistRemove, [name]), whitelistClear: () => minecraftAction(agent.whitelistClear),
  say: message => minecraftAction(agent.say, [message]), save: () => minecraftAction(agent.save),
  command: command => minecraftAction(agent.command, [command]),
  propertySet: (key, value) => minecraftAction(agent.propertySet, [key, value]),
  formatProperties: s => { const p=s.serverProperties||{}; const keys=["motd","difficulty","gamemode","max-players","view-distance","simulation-distance","pvp","allow-flight","spawn-protection","online-mode","white-list","enforce-whitelist","server-port"]; return "⚙️ **Server Properties**\n\n```\n"+keys.map(k=>k+"="+(p[k] ?? "(unset)")).join("\n")+"\n```"; }
};
