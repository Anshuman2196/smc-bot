const config = require("./config");
const API = "https://api.github.com";
async function request(method, path) {
  const response = await fetch(API + path, { method, headers: { Authorization: `Bearer ${config.ghToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "smc-control-plane" }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GitHub ${method} ${path} -> ${response.status}`);
  return response.status === 204 ? null : response.json();
}
const resource = () => `/user/codespaces/${encodeURIComponent(config.codespaceName)}`;
async function state() { return (await request("GET", resource())).state; }
async function start() { return request("POST", `${resource()}/start`); }
async function stop() { return request("POST", `${resource()}/stop`); }
module.exports = { state, start, stop };
