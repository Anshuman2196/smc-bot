const c=require('./config');
const base=(c.controlUrl||`https://${c.codespaceName}-${c.controlPort}.app.github.dev`).replace(/\/$/,'');
const auth={Authorization:`Bearer ${c.controlToken}`,'Content-Type':'application/json','User-Agent':'smc-bot-control'};
async function call(path,body={},timeout=30000){
 const r=await fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 let data={}; try{data=await r.json()}catch{}
 if(!r.ok) throw new Error(data.error||`Codespace control HTTP ${r.status}`);
 return data;
}
async function health(){const r=await fetch(base+'/health',{headers:{Authorization:`Bearer ${c.controlToken}`},signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error(`control HTTP ${r.status}`);return r.json()}
module.exports={base,health,status:()=>call('/status',{},15000),start:()=>call('/start',{},c.startTimeoutMs),stop:()=>call('/stop',{},c.stopTimeoutMs),players:()=>call('/players',{},c.commandTimeoutMs),whitelistAdd:name=>call('/whitelist_add',{name},c.commandTimeoutMs)};
