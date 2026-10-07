const config = require("./config");
const github = require("./github");
const agent = require("./agent");

let operation = null;
let lastAction = 0;
let cancellationGeneration = 0;
let forceStopped = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function cooldown() { const left = config.actionCooldownMs - (Date.now() - lastAction); if (left > 0) throw new Error(`Please wait ${Math.ceil(left / 1000)}s before another SMC action.`); lastAction = Date.now(); }
function assertActive(token) {
  if (token !== cancellationGeneration) throw new Error("SMC operation was force-stopped.");
}
async function waitFor(label, fn, timeout, report, interval = 1500, token = cancellationGeneration) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    assertActive(token);
    if (await fn()) return;
    await report(label);
    await sleep(interval);
  }
  assertActive(token);
  throw new Error(`Timed out waiting for ${label}.`);
}
async function ensureCodespace(report, token) {
  assertActive(token);
  let state = await github.state();
  if (state === "ShuttingDown") await waitFor("previous Codespace shutdown", async () => ["Shutdown", "Archived"].includes(await github.state()), config.codespaceTimeoutMs, report, 2000, token);
  state = await github.state();
  assertActive(token);
  if (["Shutdown", "Archived"].includes(state)) { await report("Starting Codespace…"); assertActive(token); await github.start(); }
  await waitFor("Codespace", async () => (await github.state()) === "Available", config.codespaceTimeoutMs, report, 2000, token);
}
async function ensureAgent(report, token) {
  await waitFor("SMC agent", () => agent.connected(), config.startTimeoutMs, async () => {
    const i = agent.info();
    await report(i.ageMs == null ? "Waiting for the SMC agent to connect…" : `Agent heartbeat ${Math.ceil(i.ageMs / 1000)}s ago…`);
  }, 1500, token);
}
async function liveStatus() {
  const result = { codespace: "offline", agent: "offline", minecraft: "offline", processAlive: false, playit: "offline", publicAddress: null, players: null, maxPlayers: null, uptimeSec: null, crashed: false, lastActionResult: null, lastStopReason: "none", crashStreak: 0, lastCrashAt: null, lastExit: null, whitelist: [], error: null };
  try { const s = await github.state(); result.codespace = s === "Available" ? "online" : s === "ShuttingDown" ? "stopping" : "offline"; } catch (e) { result.error = e.message; return result; }
  if (result.codespace !== "online") return result;
  if (!agent.connected()) return result;
  result.agent = "online";
  try { const s = agent.status(); Object.assign(result, { minecraft: s.minecraft || "unknown", processAlive: Boolean(s.processAlive), playit: s.playit === "connected" ? "online" : (s.playit || "unknown"), publicAddress: s.publicAddress || null, minecraftPort: Boolean(s.minecraftPort), crashed: Boolean(s.crashed), lastStopReason: s.lastStopReason || "none", crashStreak: s.crashStreak || 0, lastCrashAt: s.lastCrashAt || null, lastExit: s.lastExit ?? null, lastActionResult: s.lastActionResult || null, logTail: Array.isArray(s.logTail) ? s.logTail : [], players: s.players || null, maxPlayers: s.players?.max ?? s.maxPlayers ?? null, uptimeSec: s.uptimeSec ?? null, whitelist: Array.isArray(s.whitelist) ? s.whitelist : [], serverProperties: s.serverProperties || {} }); } catch (e) { result.error = e.message; }
  return result;
}
async function ensurePlayit(report = async () => {}, token = cancellationGeneration, timeout = 90000) {
  assertActive(token);
  if (!agent.connected()) throw new Error("SMC agent is offline.");
  const current = agent.status();
  if (current.playit === "online" && current.publicAddress) return current;
  await report("Minecraft is running. Connecting the Playit tunnel…");
  agent.playitEnsure();
  await waitFor("Playit tunnel", () => {
    const status = agent.status();
    return status.playit === "online" && Boolean(status.publicAddress);
  }, timeout, report, 2000, token);
  assertActive(token);
  return agent.status();
}

async function playitEnsure(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  cooldown();
  operation = "playit";
  const token = cancellationGeneration;
  try {
    await ensurePlayit(report, token);
    return liveStatus();
  } finally {
    operation = null;
  }
}

async function playitRestart(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  cooldown();
  operation = "playit-restarting";
  const token = cancellationGeneration;
  try {
    assertActive(token);
    if (!agent.connected()) throw new Error("SMC agent is offline.");
    const current = agent.status();
    if ((current.players?.online ?? 0) > 0) throw new Error("Playit restart is blocked while players are online because it will interrupt the tunnel.");
    await report("Restarting the Playit tunnel…");
    const item = agent.playitRestart();
    await waitFor("Playit tunnel restart", () => {
      const status = agent.status();
      return status.playit === "online" && Boolean(status.publicAddress) &&
        status.lastActionResult?.id === item.id;
    }, 120000, report, 2000, token);
    return liveStatus();
  } finally {
    operation = null;
  }
}

async function startServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`); cooldown(); operation = "starting";
  forceStopped = false;
  const token = cancellationGeneration;
  try {
    assertActive(token);
    agent.setDesired("running");
    await report("Minecraft desired state set to RUNNING.");
    await ensureCodespace(report, token);
    await ensureAgent(report, token);
    await waitFor("Minecraft", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000, token);
    assertActive(token);
    try {
      await ensurePlayit(report, token);
    } catch (error) {
      throw new Error(`Minecraft is running, but Playit did not connect: ${error.message} Use \`smc playit\` to retry the tunnel.`);
    }
    return liveStatus();
  } finally { operation = null; }
}
async function stopServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  cooldown(); operation = "stopping";
  const token = cancellationGeneration;
  try {
    assertActive(token);
    if ((await github.state()) !== "Available") return { stopped: true };
    if (!agent.connected()) throw new Error("SMC agent is offline; I can’t verify whether players are online.");
    const current = agent.status();
    const online = current.players?.online;
    if (online == null) throw new Error("I can’t verify the player count yet. Try again in a few seconds.");
    if (online > 0) throw new Error(`The server has ${online} player${online === 1 ? "" : "s"} online. SMC will not stop it until everyone leaves.`);
    await backupServer(report);
    agent.setDesired("stopped");
    await report("Backup complete. No players are online. Shutting Minecraft down cleanly.");
    await waitFor("Minecraft shutdown", async () => !agent.connected() || ["stopped", "offline"].includes(agent.status().minecraft), config.stopTimeoutMs, report, 1000, token);
    await report("Minecraft is empty and stopped. Stopping Codespace…");
    assertActive(token);
    await github.stop();
    await waitFor("Codespace shutdown", async () => ["Shutdown", "Archived"].includes(await github.state()), config.codespaceTimeoutMs, report, 2000, token);
    return { stopped: true };
  } finally { operation = null; }
}
async function recoverServer(report = async () => {}) {
  if (operation) return liveStatus();
  if (forceStopped) return liveStatus();
  const token = cancellationGeneration;
  if (agent.info().desiredMinecraft !== "running") return liveStatus();

  const state = await github.state();
  if (state !== "Available") {
    operation = "recovering";
    try {
      await report("Minecraft is still expected to be running. Recovering the Codespace…");
      await ensureCodespace(report, token);
      await ensureAgent(report, token);
      await waitFor("Minecraft recovery", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000, token);
      return liveStatus();
    } finally {
      operation = null;
    }
  }

  if (!agent.connected()) {
    operation = "recovering";
    try {
      await report("Codespace is online, but the SMC agent is offline. Waiting for recovery…");
      await ensureAgent(report, token);
      await waitFor("Minecraft recovery", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000, token);
      return liveStatus();
    } finally {
      operation = null;
    }
  }

  const current = agent.status();
  if (current.minecraft !== "running") {
    operation = "recovering";
    try {
      assertActive(token);
      // A heartbeat/ready-state hiccup must never become an unsolicited
      // Minecraft restart. The agent now reports the actual process state.
      if (current.processAlive) {
        await report("Minecraft process is still alive. Waiting for it to become ready…");
        await waitFor("Minecraft recovery", () => agent.status().minecraft === "running" || !agent.status().processAlive, Math.min(30000, config.startTimeoutMs), report, 2000, token);
      }

      const afterWait = agent.status();
      if (afterWait.minecraft !== "running") {
        await report("Minecraft process is not running. Starting it without a forced restart…");
        assertActive(token);
        agent.setDesired("running");
        await waitFor("Minecraft recovery", () => agent.status().minecraft === "running", config.startTimeoutMs, report, 2000, token);
      }
    } finally {
      operation = null;
    }
  }

  return liveStatus();
}
async function restartServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`); cooldown(); operation = "restarting";
  forceStopped = false;
  const token = cancellationGeneration;
  try {
    assertActive(token);
    if ((await github.state()) === "Available" && agent.connected()) {
      const current = agent.status();
      if (current.minecraft === "running") {
        const online = current.players?.online;
        if (online == null) throw new Error("I can’t verify the player count yet. Try again in a few seconds.");
        if (online > 0) throw new Error(`The server has ${online} player${online === 1 ? "" : "s"} online. Safe restart waits until everyone leaves.`);
      }
    }
    agent.setDesired("running");
    await ensureCodespace(report, token);
    await ensureAgent(report, token);
    assertActive(token);
    agent.restart();
    await waitFor("Minecraft restart", () => agent.status().minecraft === "running", config.startTimeoutMs + config.stopTimeoutMs, report, 2000, token);
    return liveStatus();
  } finally { operation = null; }
}
async function forceStop() {
  cancellationGeneration += 1;
  forceStopped = true;
  operation = "force-stopping";

  try {
    // Immediately tell the Codespace agent that Minecraft must remain stopped.
    try { agent.setDesired("stopped"); } catch (error) {
      console.error("[SMC] force-stop desired-state update failed:", error.message);
    }

    // Do not wait for the normal stop workflow. Stop the Codespace directly.
    try {
      if (await github.state() === "Available") await github.stop();
    } catch (error) {
      console.error("[SMC] force-stop Codespace shutdown failed:", error.message);
      throw new Error(`Force-stop could not stop the Codespace: ${error.message}`);
    }

    return { forced: true, stopped: true };
  } finally {
    operation = null;
  }
}
function automaticRecoveryEnabled() {
  return !forceStopped && agent.info().desiredMinecraft === "running";
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

let backupInFlight = null;
let backupProgress = { active: false, stage: "idle", message: null, startedAt: null, updatedAt: null };
function backupStatus() { return { ...backupProgress }; }
function backupActive() { return Boolean(backupInFlight); }
async function backupServer(report = async () => {}) {
  if (backupInFlight) {
    await report("A backup is already in progress. Waiting for it to finish…");
    return backupInFlight;
  }
  if (operation && operation !== "stopping") {
    throw new Error(`SMC is already ${operation}. Wait for the current action to finish before backing up.`);
  }
  const ownOperation = !operation;
  if (ownOperation) operation = "backing-up";

  backupInFlight = (async () => {
  backupProgress = { active: true, stage: "checking", message: "Checking server and agent state…", startedAt: Date.now(), updatedAt: Date.now() };
  const progress = async (stage, message) => { backupProgress = { ...backupProgress, active: true, stage, message, updatedAt: Date.now() }; await report(message); };
  const results = { codespace: null, files: null };
  const current = await liveStatus();
  if (current.agent !== "online") throw new Error("SMC agent is offline.");
  if (current.minecraft !== "running" || !current.processAlive) {
    throw new Error(`Minecraft is ${current.minecraft}. Backups are only allowed after Minecraft is fully RUNNING.`);
  }
  await progress("checking", "Minecraft is fully RUNNING. Starting a consistent backup…");
  // Never invoke the GitHub Codespaces export API while Minecraft is live.
  // The external archive below already captures the repository/server state
  // needed for SMC recovery without touching Codespace lifecycle state.
  results.codespace = {
    state: "skipped",
    reason: "live_codespace_protected",
    message: "Codespace export skipped while Minecraft is running to prevent lifecycle interruption."
  };
  await progress("world", "Live Codespace protected. Creating the server/world backup…");
  try {
    if (agent.connected()) {
      const item = agent.backup();
      results.files = await agent.waitForAction(item.id, Math.max(config.backupTimeoutMs, config.commandTimeoutMs));
      await progress("complete", "Server/world backup uploaded to GitHub Releases.");
    } else {
      results.files = { skipped: true, reason: "Minecraft is not running." };
    }
  } catch (error) {
    results.files = { error: error.message };
    await report("Server/world backup failed: " + error.message);
  }
  if (results.files?.error) {
    throw new Error(`Server/world backup failed: ${results.files.error || "unknown error"}`);
  }
  await progress("complete", "Backup finished successfully.");
  return results;
  })();
  try {
    return await backupInFlight;
  } finally {
    backupInFlight = null;
    if (ownOperation) operation = null;
    backupProgress = { ...backupProgress, active: false, updatedAt: Date.now() };
  }
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
  liveStatus, startServer, stopServer, restartServer, recoverServer, backupServer, backupStatus, backupActive, playitEnsure, playitRestart, formatOnline, formatWhitelist, formatHealth, formatLogs, formatCrash, formatAddress,
  operation: () => operation,
  forceStop,
  automaticRecoveryEnabled,
  kick: name => minecraftAction(agent.kick, [name]), ban: name => minecraftAction(agent.ban, [name]), pardon: name => minecraftAction(agent.pardon, [name]),
  op: name => minecraftAction(agent.op, [name]), deop: name => minecraftAction(agent.deop, [name]),
  whitelistAdd: name => minecraftAction(agent.whitelistAdd, [name]), whitelistRemove: name => minecraftAction(agent.whitelistRemove, [name]), whitelistClear: () => minecraftAction(agent.whitelistClear),
  say: message => minecraftAction(agent.say, [message]), save: () => minecraftAction(agent.save),
  command: command => minecraftAction(agent.command, [command]),
  propertySet: (key, value) => minecraftAction(agent.propertySet, [key, value]),
  formatProperties: s => { const p=s.serverProperties||{}; const keys=["motd","difficulty","gamemode","max-players","view-distance","simulation-distance","pvp","allow-flight","spawn-protection","online-mode","white-list","enforce-whitelist","server-port"]; return "⚙️ **Server Properties**\n\n```\n"+keys.map(k=>k+"="+(p[k] ?? "(unset)")).join("\n")+"\n```"; }
};
