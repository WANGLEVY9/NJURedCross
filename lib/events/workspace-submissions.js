import {randomUUID} from 'node:crypto';

const fail=(statusCode,message,code='workspace_submission_conflict')=>Object.assign(new Error(message),{statusCode,code});
const uncertain=()=>fail(409,'提交结果待核对，请核对原活动，不要重新创建','workspace_submission_uncertain');

/** Durable handoff boundary. All dependencies are server-owned. `inspect` must read
 * authoritative business rows and match activityId + token + digest, never a display cache.
 * Once claimed, no retry calls apply again, even when inspection finds no row. */
export function createWorkspaceSubmissions({read,update,queue,drafts,authorize,prepare,apply,inspect,now=()=>new Date().toISOString()}){
 if([read,update,queue,authorize,prepare,apply,inspect].some(value=>typeof value!=='function')||typeof drafts?.submission!=='function')throw new Error('缺少活动提交依赖');
 async function get(id){const matches=(await read()).filter(row=>row.id===id);if(matches.length!==1)throw fail(matches.length?409:404,'活动草稿不存在或重复');return matches[0];}
 const resultOf=row=>({id:row.id,version:row.version,stage:row.stage,activityId:row.submission.activityId});
 function matchesResult(result,claim){return result?.activityId===claim.activityId&&result?.token===claim.token&&result?.digest===claim.digest;}
 async function finish(id,claim,result){
  if(!matchesResult(result,claim))throw uncertain();
  const row=await get(id);
  if(row.submission?.token!==claim.token)throw uncertain();
  if(row.submission.status==='complete')return resultOf(row);
  const patch={stage:'待审批',version:row.version+1,preview:null,updatedAt:now(),submission:{...row.submission,status:'complete',completedAt:now()}};
  try{await update(id,patch,row.version);}catch(error){
   // A separate process may have reconciled the same successful handoff first.
   if(error.statusCode!==409)throw error;
   const current=await get(id);if(current.submission?.token!==claim.token||current.submission.status!=='complete')throw error;return resultOf(current);
  }
  return resultOf({...row,...patch});
 }
 return {
  submit:(id,{expectedVersion,digest},actor)=>queue(async()=>{
   const row=await get(id);await authorize(row,actor,'submit');
   if(!Number.isSafeInteger(expectedVersion)||typeof digest!=='string'||!digest)throw fail(400,'提交版本无效');
   if(row.submission){
    const claim=row.submission;
    if(claim.actor!==actor||claim.draftVersion!==expectedVersion||claim.digest!==digest)throw fail(409,'此草稿已有提交记录，请核对原申请');
    if(claim.status==='complete')return resultOf(row);
    const result=await inspect(structuredClone(claim));
    if(!result)throw uncertain();return finish(id,claim,result);
   }
   const draft=await drafts.submission(id,{expectedVersion,digest},actor);
   // Resolve the responsible account and current regional roster before claiming.
   const plan=await prepare(structuredClone(draft),actor);
   if(!plan||typeof plan!=='object'||Array.isArray(plan))throw fail(503,'活动转换配置未就绪');
   const claim={status:'pending',token:randomUUID(),activityId:`WS-${row.id}`,actor,draftVersion:expectedVersion,digest,plan:structuredClone(plan),startedAt:now()};
   // A durable compare-and-swap decides which process may perform the external write.
   await update(id,{version:row.version+1,submission:claim,updatedAt:now()},row.version);
   let result;
   try{result=await apply(structuredClone(claim));}catch{throw uncertain();}
   return finish(id,claim,result);
  }),
 };
}
