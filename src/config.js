require('dotenv').config();
const required=key=>{const v=process.env[key];if(!v)throw new Error(`Missing ${key}`);return v};
const list=key=>(process.env[key]||'').split(',').map(x=>x.trim()).filter(Boolean);
const num=(key,fallback)=>Number(process.env[key]??fallback);
module.exports={
 discordToken:required('DISCORD_TOKEN'),ghToken:required('GH_PAT'),codespaceName:required('CODESPACE_NAME'),
 controlToken:process.env.CONTROL_TOKEN||process.env.AGENT_TOKEN||'',
 controlPort:num('CONTROL_PORT',8787),controlUrl:process.env.CONTROL_URL||'',
 host:process.env.PUBLIC_HOST||'rails-canary.tun.ply.gg',port:num('PUBLIC_PORT',25565),
 notifyChannelId:process.env.NOTIFY_CHANNEL_ID||null,allowedChannelIds:list('ALLOWED_CHANNEL_IDS'),adminIds:list('ADMIN_USER_IDS'),controlRoleIds:list('CONTROL_ROLE_IDS'),
 idleMinutes:num('IDLE_SHUTDOWN_MINUTES',5),httpPort:num('PORT',10000),
 commandTimeoutMs:num('CONTROL_COMMAND_TIMEOUT_MS',60000),startTimeoutMs:num('CONTROL_START_TIMEOUT_MS',180000),stopTimeoutMs:num('CONTROL_STOP_TIMEOUT_MS',30000),
 actionCooldownMs:num('ACTION_COOLDOWN_MS',15000),codespaceTimeoutMs:num('CODESPACE_TIMEOUT_MS',900000)
};
