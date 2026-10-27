import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const action=process.argv[2];
if(!['pause','resume','status'].includes(action))throw Error('Expected pause, resume or status');
if(action==='resume'){
 const deadline=Date.now()+10000;let ready=0;
 while(ready<2){
  try{const r=await fetch('http://127.0.0.1:3000/',{signal:AbortSignal.timeout(1000)});const text=await r.text();ready=r.status===200&&text.includes('id="root"')?ready+1:0;}catch{ready=0;}
  if(ready<2&&Date.now()>=deadline)throw Error('Backend did not become ready; keep deployment queue paused');
  if(ready<2)await delay(100);
 }
}
await new Promise((resolve,reject)=>{
 const req=http.request({socketPath:'/var/lib/njuredcross-deploy/bridge.sock',path:'/'+action,method:action==='status'?'GET':'POST'},res=>{
  let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>res.statusCode===200?(process.stdout.write(text+'\n'),resolve()):reject(Error('Deployment bridge rejected '+action)));
 });
 req.setTimeout(65000,()=>req.destroy(Error('Deployment bridge control timed out')));req.on('error',reject);req.end();
});
