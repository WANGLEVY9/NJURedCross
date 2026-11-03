import {readWorkflowConfig,assertWorkflowConfigWrite,WORKFLOW_CONFIG_LIMIT} from './workflow-config-integrity.js';

const unavailable=()=>Object.assign(Error('时长审核状态暂不可用，请恢复活动私有状态备份后核对'),{statusCode:503,code:'hours_state_unavailable'});
export function readHoursConfig(event,store){
 const c=readWorkflowConfig(event);
 if(c.runningReview?.stateRef){
  const saved=store?.finalHoursState?.(event._id,c.runningReview.stateRef);
  if(saved?.status!=='running-review'||saved.runningReviewSnapshot?.status!==c.runningReview.status)throw unavailable();
  c.runningReview=saved.runningReviewSnapshot;
 }
 if(c.finalHours?.stateRef){
  const state=store?.finalHoursState?.(event._id,c.finalHours.stateRef);
  if(!state||state.status!==c.finalHours.status)throw unavailable();
  c.finalHours=state;
 }
 if(c.runningReview?.external===true){
  if(!c.finalHours?.runningReviewSnapshot||c.finalHours.runningReviewSnapshot.status!==c.runningReview.status)throw unavailable();
  c.runningReview=c.finalHours.runningReviewSnapshot;
 }
 return c;
}

/** Keep business configuration intact; only review state moves off-row. */
export function encodeHoursConfig(event,c,store){
 const next={...c};let encoded=JSON.stringify(next);
 if(encoded.length>WORKFLOW_CONFIG_LIMIT&&next.finalHours&&store?.saveFinalHoursState){
  const state={...next.finalHours};delete state.runningReviewSnapshot;
  next.finalHours={status:state.status,stateRef:store.saveFinalHoursState(event._id,state)};
  encoded=JSON.stringify(next);
  if(encoded.length>WORKFLOW_CONFIG_LIMIT&&next.runningReview){
   // A submitted source digest/preview and legacy inline entries can themselves
   // fill the column. Archive them losslessly with the final state; the short
   // event-bound reference still resolves to a SHA-256 verified immutable row.
   state.runningReviewSnapshot=next.runningReview;
   next.runningReview={status:next.runningReview.status,external:true};
   next.finalHours.stateRef=store.saveFinalHoursState(event._id,state,{compact:true});
   encoded=JSON.stringify(next);
  }
 }
 if(encoded.length>WORKFLOW_CONFIG_LIMIT&&!next.finalHours&&next.runningReview&&store?.saveFinalHoursState){
  const stateRef=store.saveFinalHoursState(event._id,{status:'running-review',runningReviewSnapshot:next.runningReview},{compact:true});
  next.runningReview={status:next.runningReview.status,stateRef};encoded=JSON.stringify(next);
 }
 assertWorkflowConfigWrite({报名页配置:encoded});return encoded;
}
