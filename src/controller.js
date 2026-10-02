const config = require("./config");
const github = require("./github");
const agent = require("./agent");

let operation = null;
let lastCommandAt = 0;
let idleTimer = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function assertCooldown() {
  const remaining = config.actionCooldownMs - (Date.now() - lastCommandAt);
  if (remaining > 0) throw new Error(`Please wait ${Math.ceil(remaining / 1000)}s before another SMC action.`);
  lastCommandAt = Date.now();
}

async function waitFor(label, predicate, timeout, report, interval = 1500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await report(label);
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function codespaceReady(report) {
  let state = await github.state();

  if (state === "ShuttingDown") {
    await report("Codespace is finishing its previous shutdown…");
    await waitFor("Codespace shutdown", async () => {
      state = await github.state();
      return state === "Shutdown" || state === "Archived";
    }, config.codespaceTimeoutMs, report, 2000);
  }

  if (state === "Shutdown" || state === "Archived") {
    await report("Starting Codespace…");
    await github.start();
  }

  await waitFor("Codespace", async () => (await github.state()) === "Available", config.codespaceTimeoutMs, report, 2000);
}

async function agentReady(report) {
  await waitFor("SMC agent", () => agent.connected(), config.startTimeoutMs, async () => {
    const info = agent.info();
    await report(info.ageMs == null ? "Waiting for the SMC agent…" : `Agent heartbeat: ${Math.round(info.ageMs / 1000)}s ago`);
  }, 1500);
}

async function liveStatus() {
  const result = {
    codespace: "offline",
    agent: "offline",
    minecraft: "offline",
    playit: "offline",
    players: null,
    maxPlayers: null,
    uptimeSec: null,
    logTail: [],
    error: null
  };

  try {
    const state = await github.state();
    result.codespace = state === "Available" ? "online" : state === "ShuttingDown" ? "stopping" : "offline";
  } catch (error) {
    result.error = error.message;
    return result;
  }

  if (result.codespace !== "online") return result;
  if (!agent.connected()) return result;

  result.agent = "online";
  try {
    const status = agent.status();
    result.minecraft = status.minecraft || "unknown";
    result.playit = status.playit || "unknown";
    result.players = status.players?.online ?? null;
    result.maxPlayers = status.players?.max ?? status.maxPlayers ?? null;
    result.uptimeSec = status.uptimeSec ?? null;
    result.logTail = status.logTail || [];
  } catch (error) {
    result.error = error.message;
  }
  return result;
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function armIdleTimer() {
  clearIdleTimer();
  if (config.idleMinutes <= 0) return;
  idleTimer = setTimeout(async () => {
    idleTimer = null;
    if (operation) return armIdleTimer();
    try {
      if (!agent.connected()) return armIdleTimer();
      const status = agent.status();
      if (status.minecraft !== "running" || (status.players?.online || 0) > 0) return armIdleTimer();
      await stopServer(async () => {}, false);
    } catch {
      armIdleTimer();
    }
  }, config.idleMinutes * 60000);
}

async function startServer(report = async () => {}, useCooldown = true) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  if (useCooldown) assertCooldown();
  operation = "starting";
  try {
    await codespaceReady(report);
    await agentReady(report);
    const status = agent.status();
    if (status.minecraft !== "running") {
      agent.requestStart();
      await report("Minecraft desired state is RUNNING. Waiting for reconciliation…");
      await waitFor("Minecraft", () => agent.connected() && agent.status().minecraft === "running", config.startTimeoutMs, report, 2000);
    }
    armIdleTimer();
    return liveStatus();
  } finally {
    operation = null;
  }
}

async function stopServer(report = async () => {}, useCooldown = true) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  if (useCooldown) assertCooldown();
  operation = "stopping";
  clearIdleTimer();
  try {
    let state = await github.state();
    if (state === "Shutdown" || state === "Archived") return { stopped: true };

    if (agent.connected()) {
      agent.requestStop();
      await report("Minecraft desired state is STOPPED. Waiting for the server to exit…");
      try {
        await waitFor("Minecraft shutdown", () => {
          if (!agent.connected()) return true;
          return ["stopped", "unknown"].includes(agent.status().minecraft);
        }, config.stopTimeoutMs, report, 1000);
      } catch (error) {
        await report(`Minecraft did not stop within the graceful window: ${error.message}`);
      }
    } else {
      await report("Agent is offline. Skipping directly to Codespace shutdown.");
    }

    await report("Stopping Codespace…");
    await github.stop();
    await waitFor("Codespace shutdown", async () => {
      state = await github.state();
      return state === "Shutdown" || state === "Archived";
    }, config.codespaceTimeoutMs, report, 2000);

    return { stopped: true };
  } finally {
    operation = null;
  }
}

async function restartServer(report = async () => {}) {
  if (operation) throw new Error(`SMC is already ${operation}.`);
  assertCooldown();
  operation = "restarting";
  try {
    await codespaceReady(report);
    await agentReady(report);
    agent.requestRestart();
    await report("Restart requested. Reconciler is replacing the Minecraft process…");
    await waitFor("Minecraft restart", () => agent.connected() && agent.status().minecraft === "running", config.startTimeoutMs, report, 2000);
    armIdleTimer();
    return liveStatus();
  } finally {
    operation = null;
  }
}

function whitelistAdd(name) {
  return agent.whitelistAdd(name);
}

module.exports = { liveStatus, startServer, stopServer, restartServer, whitelistAdd, operation: () => operation };
