const c=require("./config"),gh=require("./github"),a=require("./agent"),{pingServer}=require("./mcping");
const sleep=m=>new Promise(r=>setTimeout(r,m));
let busy=null;

// GitHub Codespaces and the Render-hosted bot can both be slow to wake up.
// Keep polling instead of treating normal startup latency as a failure.
async function wait(label,fn,timeout=600000,progress=()=>{},interval=3000){
 const start=Date.now(),end=start+timeout;
 while(Date.now()<end){
  try{const v=await fn();if(v)return v}catch{}
  const elapsed=Math.floor((Date.now()-start)/1000);
  progress(`${label} (${elapsed}s)`);
  await sleep(interval);
 }
 throw new Error("Timed out: "+label);
}

async function probe(){try{return await pingServer(c.host,c.port,5000)}catch{return null}}

async function snapshot(){
 let s={codespace:"offline",mc:"offline",playit:"offline",players:null,max:null,uptimeSec:null,errors:[]};
 try{s.codespace=({Available:"online",Shutdown:"offline",ShuttingDown:"stopping"}[await gh.getState()]||"starting")}
 catch(e){s.errors.push(e.message);return s}
 if(s.codespace!=="online")return s;
 try{
  let x=await a.status();
  s.mc={stopped:"offline",starting:"starting",running:"running",stopping:"stopping"}[x.minecraft]||"unknown";
  s.playit=x.playit==="running"?"connecting":"offline";
  s.max=x.maxPlayers;s.uptimeSec=x.uptimeSec;
  if(s.mc==="running"){let p=await a.players();s.players=p.online;s.max=p.max}
  if(s.mc==="running"&&await probe())s.playit="connected";
 }catch(e){s.mc="unknown";s.errors.push(e.message)}
 return s;
}

async function start(progress=()=>{}){
 if(busy)throw new Error("Another operation is in progress");
 busy="start";
 try{
  let st=await gh.getState();

  // If GitHub already says Available, never call /start again.
  // This makes `smc start` work even when the Codespace is already open.
  if(st==="ShuttingDown"){
   await wait("Waiting for Codespace",async()=>await gh.getState()==="Shutdown",600000,progress);
   st="Shutdown";
  }
  if(["Shutdown","Archived"].includes(st)){
   progress("Resuming Codespace…");
   await gh.start();
  }else if(st==="Available"){
   progress("Codespace already online — checking SMC agent…");
  }else if(st!=="Available"){
   progress("Waiting for Codespace…");
  }

  // Codespace creation/resume can legitimately take several minutes.
  await wait("Waiting for Codespace",async()=>await gh.getState()==="Available",900000,progress);

  // Agent startup happens inside postStartCommand, so give it plenty of time.
  // This also handles an already-running Codespace whose agent is still booting.
  const x=await wait("Waiting for SMC agent",()=>a.status(),300000,progress,4000);

  if(x.minecraft==="stopped")await a.startMinecraft();
  if(x.playit!=="running")await a.startPlayit().catch(()=>{});

  await wait("Waiting for Minecraft",async()=> (await a.status()).minecraft==="running",360000,progress);
  await wait("Waiting for Playit tunnel",async()=>!!await probe(),180000,progress);
  return snapshot();
 }finally{busy=null}
}

async function stop(progress=()=>{}){
 if(busy)throw new Error("Another operation is in progress");
 busy="stop";
 try{
  const st=await gh.getState();
  if(st!=="Available")return{already:true};

  // Stop Minecraft if necessary, but do not make Discord wait for the full
  // Minecraft/Codespace shutdown sequence. GitHub continues the stop request.
  let x=await a.status();
  if(x.minecraft!=="stopped"&&x.minecraft!=="stopping"){
   progress("Stopping Minecraft…");
   await a.stopMinecraft().catch(()=>{});
  }
  progress("Stopping Codespace…");
  await gh.stop();
  return{already:false,stopping:true};
 }finally{busy=null}
}

module.exports={snapshot,startServer:start,stopServer:stop,restartServer:start,overall:s=>s.mc==="unknown"?"error":s.codespace==="offline"?"offline":s.mc==="running"&&s.playit==="connected"?"online":"starting",isBusy:()=>busy};
