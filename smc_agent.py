#!/usr/bin/env python3
import os,sys,time,json,shlex,subprocess,threading,collections,fcntl,re,urllib.request,urllib.error
TOKEN=os.getenv("SMC_AGENT_TOKEN",""); BOT=os.getenv("SMC_BOT_URL","").rstrip("/")
DIR=os.getenv("SMC_SERVER_DIR","/workspaces/smc")
MC=shlex.split(os.getenv("SMC_MC_CMD","java -Xms4G -Xmx12G -jar fabric-server.jar nogui"))
PLAY=shlex.split(os.getenv("SMC_PLAYIT_CMD","/opt/playit/playitd --socket-path /run/playit/playitd.sock"))
if not TOKEN: raise SystemExit("SMC_AGENT_TOKEN is not set")
if not BOT.startswith(("http://","https://")): raise SystemExit("SMC_BOT_URL is not set")
DONE=re.compile(r"Done \\([\\d.,]+s\\)! For help")
LIST=re.compile(r"There are (\\d+) of a max of (\\d+) players online:?\\s*(.*)$")
NAME=re.compile(r"^[A-Za-z0-9_]{3,16}$")
class MCServer:
 def __init__(s):
  s.p=None;s.ready=False;s.stopping=False;s.ready_at=None;s.last_exit=None;s.tail=collections.deque(maxlen=20);s.lock=threading.Lock();s.cmdlock=threading.Lock();s.waiters=[]
 def alive(s): return s.p is not None and s.p.poll() is None
 def start(s):
  with s.lock:
   if s.alive(): return False
   s.ready=False;s.stopping=False;s.last_exit=None;s.ready_at=None
   s.p=subprocess.Popen(MC,cwd=DIR,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1,errors="replace")
   threading.Thread(target=s.read,args=(s.p,),daemon=True).start();return True
 def read(s,p):
  with open("/tmp/smc-minecraft.log","a") as f:
   for line in p.stdout:
    line=line.rstrip();f.write(line+"\n");f.flush();s.tail.append(line)
    if s.p is p and not s.ready and DONE.search(line):
     s.ready=True;s.ready_at=time.time()
     try:s.command("whitelist on")
     except:pass
    for w in list(s.waiters):
     m=w[0].search(line)
     if m:w[1]=m;w[2].set()
  p.wait()
  if s.p is p:s.ready=False;s.stopping=False;s.last_exit=p.returncode
 def command(s,c,rx=None,timeout=6):
  if not s.alive():raise RuntimeError("Minecraft is not running")
  with s.cmdlock:
   w=None
   if rx:w=[rx,None,threading.Event()];s.waiters.append(w)
   try:
    s.p.stdin.write(c+"\n");s.p.stdin.flush()
    return w[1] if w and w[2].wait(timeout) else None
   finally:
    if w in s.waiters:s.waiters.remove(w)
 def stop(s):
  if not s.alive():return False
  s.stopping=True
  try:s.command("say Server is shutting down...");s.command("stop")
  except:pass
  return True
 def players(s):
  if not(s.alive() and s.ready):raise RuntimeError("Minecraft is not ready")
  m=s.command("list",LIST,6)
  if not m:raise RuntimeError("Minecraft did not answer list")
  return {"online":int(m.group(1)),"max":int(m.group(2)),"players":[x.strip() for x in m.group(3).split(",") if x.strip()]}
mc=MCServer()
def playit_running():return subprocess.run(["pgrep","-x","playitd"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
def playit_start():
 os.makedirs("/run/playit",exist_ok=True)
 if playit_running():return False
 f=open("/tmp/smc-playit.log","a");subprocess.Popen(PLAY,stdout=f,stderr=subprocess.STDOUT,start_new_session=True);return True
def props():
 d={}
 try:
  for l in open(DIR+"/server.properties"):
   if "=" in l and not l.lstrip().startswith("#"):
    k,v=l.strip().split("=",1);d[k]=v
 except OSError:pass
 return d
def status():
 st="stopped" if not mc.alive() else ("stopping" if mc.stopping else ("running" if mc.ready else "starting"))
 return {"minecraft":st,"playit":"running" if playit_running() else "stopped","uptimeSec":int(time.time()-mc.ready_at) if st=="running" and mc.ready_at else None,"maxPlayers":int(props().get("max-players",20)),"lastExit":mc.last_exit,"logTail":list(mc.tail)[-10:]}
def execute(c):
 t=c.get("type")
 if t=="status":return status()
 if t=="players":return mc.players()
 if t=="minecraft.start": return {"started":mc.start()} | (playit_start() and {})
 if t=="minecraft.stop":return {"stopping":mc.stop()}
 if t=="playit.start":return {"started":playit_start()}
 raise RuntimeError("unknown command "+str(t))
def post(path,payload,timeout):
 r=urllib.request.Request(BOT+path,data=json.dumps(payload).encode(),method="POST",headers={"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json","User-Agent":"smc-agent/1"})
 with urllib.request.urlopen(r,timeout=timeout) as x:return json.loads(x.read() or b"{}")
def main():
 lock=open("/tmp/smc-agent.lock","w")
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except OSError:raise SystemExit("another SMC agent is already running")
 os.makedirs("/run/playit",exist_ok=True)
 if os.getenv("SMC_AUTOSTART","1")=="1":
  try:mc.start()
  except Exception as e:print("minecraft autostart:",e,flush=True)
  try:playit_start()
  except Exception as e:print("playit autostart:",e,flush=True)
 print("SMC agent linking to",BOT,flush=True)
 back=2
 while True:
  try:
   c=post("/agent/poll",{},70);back=2
   if c.get("id"):
    try:r={"id":c["id"],"ok":True,"data":execute(c)}
    except Exception as e:r={"id":c["id"],"ok":False,"error":str(e)}
    post("/agent/result",r,15)
  except urllib.error.HTTPError as e:
   print("HTTP",e.code,"retry",flush=True);time.sleep(back);back=min(back*2,30)
  except Exception as e:
   print("agent link error:",e,flush=True);time.sleep(back);back=min(back*2,30)
if __name__=="__main__":main()
