import http from 'node:http';
import {chmodSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** Single upstream. Never retry an application request, especially a business write. */
export function createDeployBridge({port=3001,backendPort=3000,controlPath='/var/lib/njuredcross-deploy/bridge.sock',maxQueued=256,maxQueueMs=12000}={}){
 let paused=false,active=0,waiter=null;
 const pending=new Set();
 function settle(){if(active===0&&waiter){paused=true;clearTimeout(waiter.timer);waiter.resolve();waiter=null;}}
 function forward(req,res){
  if(req.aborted||res.destroyed)return;
  active++;let finished=false;
  const done=()=>{if(finished)return;finished=true;active--;settle();};
  const upstream=http.request({host:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers:req.headers},response=>{
   res.writeHead(response.statusCode,response.headers);response.pipe(res);response.once('error',()=>res.destroy());
  });
  upstream.on('error',()=>{if(!res.headersSent&&!res.destroyed){res.writeHead(502);res.end('Upstream unavailable');}else res.destroy();done();});
  res.once('finish',done);res.once('close',()=>{upstream.destroy();done();});
  req.once('aborted',()=>upstream.destroy());req.pipe(upstream);
 }
 const server=http.createServer((req,res)=>{
  if(!paused){forward(req,res);return;}
  if(pending.size>=maxQueued){res.writeHead(503);res.end('Deployment queue full');return;}
  const item={req,res};pending.add(item);
  const remove=()=>{clearTimeout(item.timer);pending.delete(item);};
  item.timer=setTimeout(()=>{remove();if(!res.destroyed){res.writeHead(503);res.end('Deployment wait exceeded');}},maxQueueMs);
  item.remove=remove;res.once('close',remove);req.once('aborted',remove);
 });
 async function pause(timeoutMs=60000){
  if(paused)return;
  if(waiter)throw Error('Another deployment is already waiting');
  if(active===0){paused=true;return;}
  await new Promise((resolve,reject)=>{waiter={resolve,timer:setTimeout(()=>{waiter=null;reject(Error('Upstream is busy; deployment not started'));},timeoutMs)};});
 }
 function resume(){
  paused=false;
  for(const item of pending){item.remove();forward(item.req,item.res);}
 }
 const status=()=>({paused,active,queued:pending.size});
 const control=http.createServer(async(req,res)=>{
  try{
   if(req.method==='POST'&&req.url==='/pause')await pause();
   else if(req.method==='POST'&&req.url==='/resume')resume();
   else if(req.method!=='GET'||req.url!=='/status'){res.writeHead(404);res.end();return;}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(status()));
  }catch{res.writeHead(409);res.end('Deployment has not acquired an idle upstream');}
 });
 return {server,control,pause,resume,status,async listen(){
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  try{unlinkSync(controlPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  await new Promise((resolve,reject)=>{control.once('error',reject);control.listen(controlPath,resolve);});chmodSync(controlPath,0o600);
 },async close(){
  if(waiter){clearTimeout(waiter.timer);waiter.resolve();waiter=null;}
  for(const item of pending){item.remove();item.res.destroy();}
  await Promise.all([server,control].map(s=>new Promise(resolve=>s.close(resolve))));
 }};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const bridge=createDeployBridge();await bridge.listen();
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void bridge.close();});
}
