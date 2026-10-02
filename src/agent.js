const cfg = require("./config");
let lastSeen=0,lastStatus=null,desiredMinecraft=null,restartNonce=0,actionSequence=0;
const actions=[];
function heartbeat(status){lastSeen=Date.now();if(status&&typeof status==="object")lastStatus=status;}
function alive(){return lastSeen>0&&Date.now()-lastSeen<=cfg.agentStaleMs;}
function setDesired(state){if(!["running","stopped"].includes(state))throw new Error("Invalid desired Minecraft state");desiredMinecraft=state;}
function requestRestart(){restartNonce+=1;desiredMinecraft="running";return restartNonce;}
function enqueueAction(type,args={}){const id=`${Date.now()}-${++actionSequence}`;actions.push({id,type,args});return id;}
function sync(status){heartbeat(status);if(desiredMinecraft===null)desiredMinecraft=["running","starting","stopping"].includes(status?.minecraft)?"running":"stopped";return{desiredMinecraft,restartNonce,action:actions.shift()||null};}
function auth(req){return req.headers.authorization===`Bearer ${cfg.agentToken}`;}
function info(){return{online:alive(),lastSeen,ageMs:lastSeen?Date.now()-lastSeen:null,desiredMinecraft,restartNonce,status:lastStatus};}
function status(){if(!alive())throw new Error("SMC agent is offline");return{...(lastStatus||{minecraft:"unknown",playit:"unknown"})};}
function whitelistAdd(name){if(!alive())throw new Error("SMC agent is offline");enqueueAction("whitelist.add",{name});return{queued:true,name};}
module.exports={auth,sync,heartbeat,alive,info,status,setDesired,requestRestart,whitelistAdd};
