import {randomUUID} from 'node:crypto';

const fail=(statusCode,message,code='workspace_submission_conflict')=>Object.assign(new Error(message),{statusCode,code});
const uncertain=()=>fail(409,'提交结果待核对，请核对原活动，不要重新创建','workspace_submission_uncertain');

/** Durable handoff boundary. All dependencies are server-owned. `inspect` must read
 * authoritative business rows and match activityId + token + digest, never a display cache.
 * Once claimed, no retry calls apply again, even when inspection finds no row. */
export function createWorkspaceSubmissions({readById,update,queue,drafts,authorize,prepare,apply,inspect,now=()=>new Date().toISOString()}){
 if([readById,update,queue,authorize,prepare,apply,inspect].some(value=>typeof value!=='function')||typeof drafts?.submission!=='function')throw new Error('缺少活动提交依赖');
 async function get(id){const matches=await readById(id);if(matches.length!==1)throw fail(matches.length?409:404,'活动草稿不存在或重复');return matches[0];}
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
  restore:(id,{expectedVersion},actor)=>queue(async()=>{
   const row=await get(id);await authorize(row,actor,row.submission?.status==='complete'?'reconcile':row.submission?'restore':'edit');
   if(row.submission?.status==='complete')return {...resultOf(row),restored:false};
   if(!Number.isSafeInteger(expectedVersion))throw fail(400,'恢复版本无效');
   if(!row.submission&&!row.removal&&row.stage==='草稿'&&row.lastRecovery?.fromVersion===expectedVersion&&row.lastRecovery.actor===actor)return {id,version:row.version,stage:row.stage,restored:true};
   if(row.version!==expectedVersion||row.submission?.status!=='pending'||row.removal)throw fail(409,'草稿状态已变化，请刷新后核对');
   const claim=structuredClone(row.submission),result=await inspect(claim);
   if(result)return {...await finish(id,claim,result),restored:false};
   const at=now(),patch={stage:'草稿',version:row.version+1,preview:null,submission:null,updatedAt:at,
    submissionHistory:[...(row.submissionHistory||[]),{...claim,status:'cancelled',recoveredBy:actor,recoveredAt:at}],
    lastRecovery:{actor,fromVersion:expectedVersion,token:claim.token,at}};
   await update(id,patch,row.version);
   return {id,version:patch.version,stage:patch.stage,restored:true};
  }),
  reconcile:(id,actor)=>queue(async()=>{
   const row=await get(id);await authorize(row,actor,'reconcile');
   const claim=row.submission;if(!claim)throw fail(409,'当前草稿没有待核对的提交');
   if(claim.status==='complete')return resultOf(row);
   const result=await inspect(structuredClone(claim));
   if(!result)throw fail(409,'尚未查到匹配的正式活动；负责人或超管可点击“恢复为可编辑草稿”，系统会再次核对后恢复操作','workspace_submission_uncertain');
   return finish(id,claim,result);
  }),
  submit:(id,{expectedVersion,digest},actor)=>queue(async()=>{
   const row=await get(id);await authorize(row,actor,row.submission?'reconcile':'submit');
   if(!Number.isSafeInteger(expectedVersion)||typeof digest!=='string'||!digest)throw fail(400,'提交版本无效');
   if(row.submission){
    const claim=row.submission;
    if(claim.draftVersion!==expectedVersion||claim.digest!==digest)throw fail(409,'此草稿已有提交记录，请核对原申请');
    if(claim.status==='complete')return resultOf(row);
    const result=await inspect(structuredClone(claim));
    if(!result)throw uncertain();return finish(id,claim,result);
   }
   const previous=row.submissionHistory?.at(-1);
   if(previous&&await inspect(structuredClone(previous)))throw fail(409,'此前提交的正式活动已出现，请刷新列表查看原活动；本次未重复创建');
   const draft=await drafts.submission(id,{expectedVersion,digest},actor);
   // Resolve the responsible account and current regional roster before claiming.
   const plan=await prepare(structuredClone(draft),actor);
   if(!plan||typeof plan!=='object'||Array.isArray(plan))throw fail(503,'活动转换配置未就绪');
   const claim={draftId:row.id,status:'pending',token:randomUUID(),activityId:`WS-${row.id}`,actor,draftVersion:expectedVersion,digest,plan:structuredClone(plan),startedAt:now()};
   // A durable compare-and-swap decides which process may perform the external write.
   await update(id,{version:row.version+1,submission:claim,updatedAt:now()},row.version);
   let result;
   try{result=await apply(structuredClone(claim));}catch{throw uncertain();}
   return finish(id,claim,result);
  }),
 };
}
