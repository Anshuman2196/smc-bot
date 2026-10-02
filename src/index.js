const http=require('http');
const {Client,GatewayIntentBits}=require('discord.js');
const c=require('./config');
const ctl=require('./controller');
const agent=require('./agent');
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
const reply=(m,x)=>m.reply({content:x,allowedMentions:{repliedUser:false}});
const isControl=m=>m&&(c.adminIds.includes(m.id)||c.controlRoleIds.length&&m.roles?.cache?.some(r=>c.controlRoleIds.includes(r.id))||(!c.adminIds.length&&!c.controlRoleIds.length));
const allowed=id=>!c.allowedChannelIds.length||c.allowedChannelIds.includes(id);
async function statusText(){const s=await ctl.snapshot();return ['**SMC Status**','',`Codespace: **${s.codespace}**`,`Minecraft: **${s.mc}**`,`Playit: **${s.playit}**`,`Players: **${s.players??'—'}/${s.max??'—'}` ,`Uptime: **${s.uptimeSec==null?'—':Math.floor(s.uptimeSec/60)+'m'}**`,s.errors?.[0]?`⚠️ ${s.errors[0]}`:'','',`Address: **${c.host}**`].join('\n')}
function progress(m){let last=0;return async x=>{const now=Date.now();if(now-last<2500)return;last=now;const text=String(x);await m.edit('🟡 **SMC operation in progress**\n`'+text.replace(/`/g,"'")+'`').catch(()=>{})}}
client.on('messageCreate',async m=>{if(m.author.bot||!m.guild||!allowed(m.channelId))return;const p=m.content.trim().split(/\s+/);if(p[0]?.toLowerCase()!=='smc')return;const cmd=(p[1]||'help').toLowerCase();try{
 if(cmd==='status')return reply(m,await statusText());
 if(['start','stop','restart','whitelist'].includes(cmd)&&!isControl(m.member))return reply(m,"⚠️ You don't have permission to control SMC.");
 if(cmd==='whitelist'&&p[2]?.toLowerCase()==='add'){if(!p[3])return reply(m,'Usage: `smc whitelist add <username>`');const r=await ctl.whitelistAdd(p[3]);return reply(m,`✅ Added **${r.added||p[3]}** to the whitelist.`)}
 if(['start','stop','restart'].includes(cmd)){const r=await reply(m,cmd==='start'?'🟡 Starting SMC…':cmd==='stop'?'🟡 Stopping SMC…':'🟡 Restarting SMC…');const pg=progress(r);if(cmd==='start')await ctl.startServer(pg);else if(cmd==='stop')await ctl.stopServer(pg);else await ctl.restartServer(pg);return r.edit(cmd==='stop'?'🔴 **SMC stopped.**':`🟢 **SMC online!**\n\n${c.host}`).catch(()=>{})}
 return reply(m,['**SMC commands**','`smc start` — start the server','`smc stop` — stop the server and Codespace','`smc restart` — restart Minecraft','`smc status` — show live status','`smc whitelist add <username>` — add a player'].join('\n'));
}catch(e){return reply(m,`⚠️ ${e.message||'SMC operation failed'}`)}});
const server=http.createServer(async(req,res)=>{
 const send=(code,obj)=>{const b=JSON.stringify(obj);res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Length':Buffer.byteLength(b)});res.end(b)};
 if(req.method==='GET'&&(req.url==='/'||req.url==='/health'))return send(200,{ok:true,agent:agent.queueInfo()});
 if(req.method==='POST'&&(req.url==='/agent/poll'||req.url==='/agent/progress'||req.url==='/agent/result')){
  if(!agent.auth(req))return send(401,{error:'unauthorized'});
  if(req.url==='/agent/poll'){let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{let body={};try{body=JSON.parse(raw||'{}')}catch{};return send(200,{...agent.poll(body.status||null),status:agent.queueInfo().status})});return;}
  let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{try{const body=JSON.parse(raw||'{}');const ok=req.url==='/agent/progress'?agent.progress(body):agent.result(body);send(200,{ok})}catch(e){send(400,{error:e.message})}});return;
 }
 return send(404,{error:'not_found'});
});
server.listen(c.httpPort,'0.0.0.0',()=>console.log(`SMC HTTP listening on ${c.httpPort}`));
client.login(c.discordToken);
