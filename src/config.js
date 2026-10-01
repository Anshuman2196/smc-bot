require("dotenv").config();
const req=k=>{if(!process.env[k])throw new Error("Missing "+k);return process.env[k]};
const list=k=>(process.env[k]||"").split(",").map(x=>x.trim()).filter(Boolean);
const num=(k,d)=>Number(process.env[k]??d);
module.exports={discordToken:req("DISCORD_TOKEN"),ghToken:req("GH_PAT"),codespaceName:req("CODESPACE_NAME"),agentToken:req("AGENT_TOKEN"),host:process.env.PUBLIC_HOST||"rails-canary.tun.ply.gg",port:num("PUBLIC_PORT",25565),notifyChannelId:process.env.NOTIFY_CHANNEL_ID||null,allowedChannelIds:list("ALLOWED_CHANNEL_IDS"),adminIds:list("ADMIN_USER_IDS"),controlRoleIds:list("CONTROL_ROLE_IDS"),idleMinutes:num("IDLE_SHUTDOWN_MINUTES",5),httpPort:num("PORT",10000)};
