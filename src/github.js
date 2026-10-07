const config = require("./config");
const API = "https://api.github.com";
async function request(method, path) {
  const response = await fetch(API + path, { method, headers: { Authorization: `Bearer ${config.ghToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "smc-control-plane" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch {}
    let message = `GitHub ${method} ${path} -> ${response.status}`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed.message) message += `: ${parsed.message}`;
    } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}
const resource = () => `/user/codespaces/${encodeURIComponent(config.codespaceName)}`;
let backupState = { state: "never", branch: null, sha: null, completedAt: null, error: null };

async function exportCodespace() {
  try {
    backupState = { ...backupState, state: "starting", error: null };
    try {
      await request("POST", `${resource()}/exports`);
    } catch (error) {
      if (!/422:.*export of that codespace is already in progress/i.test(error.message)) throw error;
      // GitHub serializes Codespace exports. Reuse the export already running.
    }
    const deadline = Date.now() + config.backupTimeoutMs;
    while (Date.now() < deadline) {
      const current = await request("GET", `${resource()}/exports/latest`);
      backupState = {
        state: current.state || "unknown",
        branch: current.branch || null,
        sha: current.sha || null,
        completedAt: current.completed_at || null,
        error: null
      };
      if (current.state === "succeeded") return backupState;
      if (["failed", "errored"].includes(current.state)) throw new Error("Codespace export failed.");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error("Codespace export timed out.");
  } catch (error) {
    backupState = { ...backupState, state: "failed", error: error.message };
    throw error;
  }
}
function backupStatus() { return { ...backupState }; }
async function state() { return (await request("GET", resource())).state; }
async function start() { return request("POST", `${resource()}/start`); }
async function stop() { return request("POST", `${resource()}/stop`); }
module.exports = { state, start, stop, exportCodespace, backupStatus };
