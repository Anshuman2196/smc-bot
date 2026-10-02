require('dotenv').config();
const required=key=>{const v=process.env[key];if(!v)throw new Error(`Missing ${key}`);return v};
const list=key=>(process.env[key]||'').split(',').map(x=>x.trim()).filter(Boolean);
const num=(key,fallback)=>Number(process.env[key]??fallback);
const agentToken=process.env.AGENT_TOKEN||process.env.CONTROL_TOKEN||'';
module.exports={
 discordToken:required('DISCORD_TOKEN'),ghToken:required('GH_PAT'),codespaceName:required('CODESPACE_NAME'),
 agentToken,controlToken:agentToken,
 controlPort:num('CONTROL_PORT',8787),controlUrl:process.env.CONTROL_URL||'',
 host:process.env.PUBLIC_HOST||'rails-canary.tun.ply.gg',port:num('PUBLIC_PORT',25565),
 notifyChannelId:process.env.NOTIFY_CHANNEL_ID||null,allowedChannelIds:list('ALLOWED_CHANNEL_IDS'),adminIds:list('ADMIN_USER_IDS'),controlRoleIds:list('CONTROL_ROLE_IDS'),
 idleMinutes:num('IDLE_SHUTDOWN_MINUTES',5),httpPort:num('PORT',10000),
 commandTimeoutMs:num('AGENT_COMMAND_TIMEOUT_MS',90000),statusTimeoutMs:num('AGENT_STATUS_TIMEOUT_MS',30000),agentStaleMs:num('AGENT_STALE_MS',120000),
 startTimeoutMs:num('AGENT_START_TIMEOUT_MS',480000),stopTimeoutMs:num('AGENT_STOP_TIMEOUT_MS',30000),
 actionCooldownMs:num('ACTION_COOLDOWN_MS',15000),codespaceTimeoutMs:num('CODESPACE_TIMEOUT_MS',900000)
};
