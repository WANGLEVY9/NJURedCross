import {observer} from '../observability.js';
import {apiFailure} from '../http/errors.js';

const stages=new Set(['initialize','account','data','attendance','projection','hours']);
/** Fixed labels only: never attach account data or an upstream exception to diagnostics. */
export async function memberReadStage(stage,task,telemetry=observer){
 if(!stages.has(stage))throw new TypeError('Unknown member read stage');
 return telemetry.dependency('content',`member-${stage}`,async()=>{
  try{return await task();}
  catch(error){
   const failure=apiFailure(error,{method:'GET'});
   // Keep existing authentication, cancellation, timeout and upstream failure contracts.
   if(failure.status!==500||failure.payload.code)throw error;
   throw Object.assign(new Error('Member read failed'),{
    statusCode:500,code:`workflow_member_${stage}_failed`,
   });
  }
 });
}
