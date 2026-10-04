require("dotenv").config();
const required=name=>{const value=String(process.env[name]||"").trim();if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;};
const list=name=>String(process.env[name]||"").split(",").map(x=>x.trim()).filter(Boolean);
const number=(name,fallback,min=0)=>{const n=Number(process.env[name]);return Number.isFinite(n)&&n>=min?n:fallback;};
const agentToken=String(process.env.AGENT_TOKEN||process.env.SMC_AGENT_TOKEN||"").trim();
if(!agentToken)throw new Error("Missing required environment variable: AGENT_TOKEN");
module.exports=Object.freeze({
 discordToken:required("DISCORD_TOKEN"), ghToken:required("GH_PAT"), codespaceName:required("CODESPACE_NAME"), agentToken,
 host:String(process.env.PUBLIC_HOST||"").trim(), port:number("PUBLIC_PORT",25565), httpPort:number("PORT",10000),
 idleMinutes:number("IDLE_SHUTDOWN_MINUTES",5), agentStaleMs:number("AGENT_STALE_MS",15000), pollWaitMs:number("AGENT_POLL_WAIT_MS",10000),
 commandTimeoutMs:number("AGENT_COMMAND_TIMEOUT_MS",60000), startTimeoutMs:number("AGENT_START_TIMEOUT_MS",480000), stopTimeoutMs:number("AGENT_STOP_TIMEOUT_MS",60000),
 actionCooldownMs:number("ACTION_COOLDOWN_MS",5000), codespaceTimeoutMs:number("CODESPACE_TIMEOUT_MS",900000), crashMaxRetries:number("SMC_CRASH_MAX_RETRIES",1,0), crashCooldownMs:number("SMC_CRASH_COOLDOWN_MS",60000,1000), codespaceKeepaliveMinutes:number("CODESPACE_KEEPALIVE_MINUTES",5,1),
 notifyChannelId:process.env.NOTIFY_CHANNEL_ID||null, allowedChannelIds:list("ALLOWED_CHANNEL_IDS"), adminIds:list("ADMIN_USER_IDS"), controlRoleIds:list("CONTROL_ROLE_IDS"), adminRoleIds:list("ADMIN_ROLE_IDS")
});
