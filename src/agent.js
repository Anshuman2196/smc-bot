const cfg=require("./config");let id=1;const q=[],pending=new Map(),waiters=[];
function enqueue(type,args={},timeout=30000){const i=Date.now()+"-"+id++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(i);reject(new Error("SMC agent did not respond to "+type))},timeout);pending.set(i,{resolve,reject,timer});q.push({id:i,type,args});wake()})}
function wake(){if(q.length&&waiters.length)waiters.shift()(q.shift())}
function poll(){if(q.length)return Promise.resolve(q.shift());return new Promise(resolve=>{const t=setTimeout(()=>{const i=waiters.indexOf(resolve);if(i>=0)waiters.splice(i,1);resolve({})},25000);waiters.push(c=>{clearTimeout(t);resolve(c)})})}
function result(p){const j=p&&pending.get(p.id);if(!j)return false;pending.delete(p.id);clearTimeout(j.timer);p.ok?j.resolve(p.data):j.reject(new Error(p.error||"agent command failed"));return true}
function auth(r){return r.headers.authorization===`Bearer ${cfg.agentToken}`}
module.exports={auth,poll,result,status:()=>enqueue("status"),players:()=>enqueue("players"),startMinecraft:()=>enqueue("minecraft.start",{},120000),stopMinecraft:()=>enqueue("minecraft.stop"),startPlayit:()=>enqueue("playit.start")};
