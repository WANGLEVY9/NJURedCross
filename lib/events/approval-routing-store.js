import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMutationQueue} from './safety.js';
import {validateApprovalMappings} from './approval-routing.js';

const empty=()=>({version:0,mappings:{}});
export function createApprovalRoutingStore(path){
 const serial=createMutationQueue();
 async function read(){
  let raw;try{raw=await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return empty();throw error;}
  try{
   const data=JSON.parse(raw);
   if(!Number.isSafeInteger(data.version)||data.version<0)throw Error('Invalid version');
   return {version:data.version,mappings:validateApprovalMappings(data.mappings)};
  }catch{throw Object.assign(new Error('审核主席配置文件无效，已停止提交审批'),{statusCode:503,code:'approval_config_invalid'});}
 }
 return {read,update:(version,buildMappings)=>serial(async()=>{
  const current=await read();
  if(!Number.isSafeInteger(version)||version!==current.version)throw Object.assign(new Error('审核主席配置已变化，请刷新后再保存'),{statusCode:409});
  const mappings=validateApprovalMappings(await buildMappings()),next={version:current.version+1,mappings};
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.${randomUUID()}.tmp`;
  try{await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return next;
 })};
}
