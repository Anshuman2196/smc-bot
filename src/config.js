require("dotenv").config();

const required = key => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
};
const list = key => (process.env[key] || "").split(",").map(x => x.trim()).filter(Boolean);
const num = (key, fallback) => Number(process.env[key] ?? fallback);

module.exports = {
  discordToken: required("DISCORD_TOKEN"),
  ghToken: required("GH_PAT"),
  codespaceName: required("CODESPACE_NAME"),
  agentToken: required("AGENT_TOKEN"),
  host: process.env.PUBLIC_HOST || "rails-canary.tun.ply.gg",
  port: num("PUBLIC_PORT", 25565),
  notifyChannelId: process.env.NOTIFY_CHANNEL_ID || null,
  allowedChannelIds: list("ALLOWED_CHANNEL_IDS"),
  adminIds: list("ADMIN_USER_IDS"),
  controlRoleIds: list("CONTROL_ROLE_IDS"),
  idleMinutes: num("IDLE_SHUTDOWN_MINUTES", 5),
  httpPort: num("PORT", 10000),
  agentStaleMs: num("AGENT_STALE_MS", 150000),
  pollWaitMs: num("AGENT_POLL_WAIT_MS", 20000),
  commandTimeoutMs: num("AGENT_COMMAND_TIMEOUT_MS", 100000),
  statusTimeoutMs: num("AGENT_STATUS_TIMEOUT_MS", 100000),
  startTimeoutMs: num("AGENT_START_TIMEOUT_MS", 180000),
  stopTimeoutMs: num("AGENT_STOP_TIMEOUT_MS", 30000),
  actionCooldownMs: num("ACTION_COOLDOWN_MS", 15000),
  codespaceTimeoutMs: num("CODESPACE_TIMEOUT_MS", 900000)
};
