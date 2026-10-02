require("dotenv").config();

const required = key => {
  const value = String(process.env[key] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};
const list = key => String(process.env[key] || "").split(",").map(v => v.trim()).filter(Boolean);
const number = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
};

const agentToken = String(process.env.AGENT_TOKEN || process.env.SMC_AGENT_TOKEN || "").trim();
if (!agentToken) throw new Error("Missing required environment variable: AGENT_TOKEN");

module.exports = Object.freeze({
  discordToken: required("DISCORD_TOKEN"),
  ghToken: required("GH_PAT"),
  codespaceName: required("CODESPACE_NAME"),
  agentToken,
  host: String(process.env.PUBLIC_HOST || "rails-canary.tun.ply.gg").trim(),
  port: number("PUBLIC_PORT", 25565),
  httpPort: number("PORT", 10000),
  idleMinutes: number("IDLE_SHUTDOWN_MINUTES", 5),
  agentStaleMs: number("AGENT_STALE_MS", 60000),
  pollWaitMs: number("AGENT_POLL_WAIT_MS", 10000),
  commandTimeoutMs: number("AGENT_COMMAND_TIMEOUT_MS", 60000),
  startTimeoutMs: number("AGENT_START_TIMEOUT_MS", 480000),
  stopTimeoutMs: number("AGENT_STOP_TIMEOUT_MS", 60000),
  actionCooldownMs: number("ACTION_COOLDOWN_MS", 5000),
  codespaceTimeoutMs: number("CODESPACE_TIMEOUT_MS", 900000),
  notifyChannelId: process.env.NOTIFY_CHANNEL_ID || null,
  allowedChannelIds: list("ALLOWED_CHANNEL_IDS"),
  adminIds: list("ADMIN_USER_IDS"),
  controlRoleIds: list("CONTROL_ROLE_IDS")
});
