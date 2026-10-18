import {readFile,mkdir,open,access,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMutationQueue} from './safety.js';

/** Private operational metadata only; no business table or approval configuration is rewritten. */
export function createHoursSubmissionStore(path){
 const serial=createMutationQueue();let memory={},seen=false;
 const unavailable=()=>Object.assign(new Error('时长提交记录无法读取，请联系管理员核对，暂时禁止修改'),{statusCode:503});
 // The marker contains no operational data. Keep it beside the private JSON so
 // a restart cannot mistake a lost, previously initialized store for a new install.
 const marker=path?`${path}.initialized`:null;
 async function syncDirectory(){
  if(process.platform==='win32')return;
  const handle=await open(dirname(path),'r');try{await handle.sync();}finally{await handle.close();}
 }
 async function markInitialized(){
  let handle;try{handle=await open(marker,'wx',0o600);}catch(error){if(error.code==='EEXIST')return;throw error;}
  try{await handle.writeFile('initialized-v1\n');await handle.sync();}finally{await handle.close();}
  await syncDirectory();
 }
 async function persist(all){
  await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${randomUUID()}.tmp`;
  try{
   const handle=await open(temporary,'wx',0o600);
   try{await handle.writeFile(JSON.stringify(all)+'\n');await handle.sync();}finally{await handle.close();}
   await rename(temporary,path);seen=true;await syncDirectory();
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 async function read(){
  if(!path)return structuredClone(memory);
  let text;try{text=await readFile(path,'utf8');seen=true;}catch(error){
   if(error.code==='ENOENT'&&!seen){
    try{await access(marker);}catch(markerError){if(markerError.code==='ENOENT')return {};}
   }
   throw unavailable();
  }
  try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data)||Object.values(data).some(row=>!row||!Number.isSafeInteger(row.revision)||row.revision<1||!['draft','submitted','returned'].includes(row.phase)||!row.absences||typeof row.absences!=='object'||Array.isArray(row.absences)||Object.values(row.absences).some(absence=>!absence||typeof absence.reason!=='string'||!absence.reason.trim()||absence.reason.length>500)))throw Error('invalid');await markInitialized();return data;}
  catch{throw unavailable();}
 }
 return {read,update:(key,revision,build)=>serial(async()=>{
  const all=await read(),current=all[key]||{revision:0,phase:'draft',absences:{}};
  if(!Number.isSafeInteger(revision)||revision!==current.revision)throw Object.assign(new Error('时长表已变化，请刷新后重试'),{statusCode:409});
  const next={...await build(structuredClone(current)),revision:current.revision+1};
  if(!path){all[key]=next;memory=structuredClone(all);return next;}
  // Bootstrap a durable empty JSON before the marker, then mark before committing
  // any operational state. A crash before that final rename leaves the old JSON.
  if(!seen){await persist(all);await markInitialized();}
  all[key]=next;await persist(all);
  return next;
 })};
}
