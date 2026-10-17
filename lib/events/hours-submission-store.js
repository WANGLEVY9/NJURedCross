import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMutationQueue} from './safety.js';

/** Private operational metadata only; no business table or approval configuration is rewritten. */
export function createHoursSubmissionStore(path){
 const serial=createMutationQueue();let memory={},seen=false;
 const unavailable=()=>Object.assign(new Error('时长提交记录无法读取，请联系管理员核对，暂时禁止修改'),{statusCode:503});
 async function read(){
  if(!path)return structuredClone(memory);
  let text;try{text=await readFile(path,'utf8');seen=true;}catch(error){if(error.code==='ENOENT'&&!seen)return {};throw unavailable();}
  try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data)||Object.values(data).some(row=>!row||!Number.isSafeInteger(row.revision)||row.revision<1||!['draft','submitted','returned'].includes(row.phase)||!row.absences||typeof row.absences!=='object'||Array.isArray(row.absences)||Object.values(row.absences).some(absence=>!absence||typeof absence.reason!=='string'||!absence.reason.trim()||absence.reason.length>500)))throw Error('invalid');return data;}
  catch{throw unavailable();}
 }
 return {read,update:(key,revision,build)=>serial(async()=>{
  const all=await read(),current=all[key]||{revision:0,phase:'draft',absences:{}};
  if(!Number.isSafeInteger(revision)||revision!==current.revision)throw Object.assign(new Error('时长表已变化，请刷新后重试'),{statusCode:409});
  const next={...await build(structuredClone(current)),revision:current.revision+1};all[key]=next;
  if(!path){memory=structuredClone(all);return next;}
  await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${randomUUID()}.tmp`;
  try{await writeFile(temporary,JSON.stringify(all)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);seen=true;}
  finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return next;
 })};
}
