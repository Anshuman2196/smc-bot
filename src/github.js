const config = require("./config");

const API = "https://api.github.com";

async function request(method, path) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "smc-control-bot-v5"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub ${method} ${path} -> ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
  }
  return response.status === 204 ? null : response.json();
}

const path = () => `/user/codespaces/${encodeURIComponent(config.codespaceName)}`;

async function state() {
  const data = await request("GET", path());
  return data.state;
}

async function start() {
  return request("POST", `${path()}/start`);
}

async function stop() {
  return request("POST", `${path()}/stop`);
}

module.exports = { state, start, stop };
