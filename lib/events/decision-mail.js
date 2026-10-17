import {confirmationMessage,leaveDecisionMessage,rejectionMessage} from './registration-notifications.js';
import {assertCompleteRows} from './safety.js';
import {normalizeDecisionItem} from './decision-mail-store.js';

const confirmed=row=>['已确认','已签到'].includes(row['报名状态'])&&[true,'true'].includes(row['是否报名成功']);

function evaluate(data,item,origin){
 assertCompleteRows(data?.events,data?.registrations);
 const matches=data.registrations.filter(row=>row._id===item.id);
 if(matches.length>1)throw Error('Ambiguous decision registration');
 const row=matches[0];if(!row)return {state:'cancelled'};
 const events=data.events.filter(event=>event['活动ID']===row['活动ID']);
 if(events.length>1)throw Error('Ambiguous decision event');
 const event=events[0];if(!event)return {state:'cancelled'};
 const config=JSON.parse(event['报名页配置']||'{}');
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('Invalid decision event configuration');
 if(item.kind!=='leave'&&config.rosterReview)return {state:'cancelled'};
 if(item.kind==='confirm'){
  if(!confirmed(row))return {state:'cancelled'};
  if(row['请假状态']==='待审批'||config.source?.kind==='generated_blood'&&row['岗位同步状态']!=='已同步')return {state:'deferred'};
  return {message:confirmationMessage(event,row,origin)};
 }
 if(item.kind==='reject')return row['报名状态']==='未入选'?{message:rejectionMessage(event,row,item.reason??row['处理说明'],origin)}:{state:'cancelled'};
 if(row['请假申请时间']!==item.requestAt)return {state:'cancelled'};
 if(row['请假状态']==='待审批')return {state:'deferred'};
 if(row['请假状态']!==(item.approved?'已批准':'已驳回')||item.approved&&row['报名状态']!=='已请假')return {state:'cancelled'};
 return {message:leaveDecisionMessage(event,row,{approved:item.approved,reason:item.reason},origin)};
}

export function decisionMessage(data,item,origin='https://njuredcross.cn'){
 return evaluate(data,normalizeDecisionItem(item),origin).message??null;
}

export function createDecisionMail({read,send,store,origin='https://njuredcross.cn',schedule=task=>setImmediate(task),retryDelay=30_000,maxAttempts=3,now=Date.now,onError=()=>{}}={}){
 if(typeof read!=='function'||typeof send!=='function'||!store||!['create','pending','get','transition','defer','nextAttemptAt','info'].every(key=>typeof store[key]==='function'))throw Error('Decision mail requires read, send and a durable store');
 if(!Number.isSafeInteger(retryDelay)||retryDelay<1||!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw Error('Invalid decision mail retry options');
 let running=null,retryTimer=null,scheduled=false,closed=false;
 const report=error=>{try{onError(error);}catch{}};
 function wake(){
  if(closed||scheduled||running)return;
  scheduled=true;
  try{schedule(()=>{scheduled=false;void drain().catch(report);});}catch(error){scheduled=false;report(error);arm();}
 }
 function arm(){
  if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
  if(closed)return;
  try{
   const due=store.nextAttemptAt();if(due===null)return;
   retryTimer=setTimeout(()=>{retryTimer=null;wake();},Math.min(2_147_483_647,Math.max(1,due-now())));
   retryTimer.unref?.();
  }catch(error){report(error);}
 }
 async function run(){
  const results={sent:0,skipped:0,failed:0,deferred:0,unknown:0};
  while(!closed){
   const entries=store.pending({now:now(),limit:100});if(!entries.length)break;
   for(const entry of entries){
    if(closed)break;
    let current;
    try{current=evaluate(await read(),entry.item,origin);}
    catch(error){
     report(error);store.defer(entry.key,now()+retryDelay);results.deferred++;continue;
    }
    if(current.state==='deferred'){
     store.defer(entry.key,now()+retryDelay);results.deferred++;continue;
    }
    if(current.state==='cancelled'){
     store.transition(entry.key,'pending','cancelled');results.skipped++;continue;
    }
    if(entry.message&&(entry.message.to!==current.message.to||entry.message.idempotencyKey!==current.message.idempotencyKey)){
     store.transition(entry.key,'pending','unknown');results.unknown++;continue;
    }
    if(entry.attempts>=maxAttempts){store.transition(entry.key,'pending','cancelled');results.failed++;continue;}
    const claimed=store.transition(entry.key,'pending','sending',{message:entry.message??current.message});
    let outcome;
    try{outcome=await send(claimed.message);}catch(error){report(error);}
    const success=outcome?.ok===true&&['smtp','idempotent-skip'].includes(outcome.transport);
    if(success){store.transition(entry.key,'sending','sent');results.sent++;}
    else if(outcome?.ok===false&&outcome.retryable===true){
     store.transition(entry.key,'sending',claimed.attempts>=maxAttempts?'failed':'pending',{nextAttemptAt:now()+retryDelay});results.failed++;
    }else{store.transition(entry.key,'sending','unknown');results.unknown++;}
   }
  }
  return results;
 }
 function drain(){
  if(running)return running;
  if(closed)return Promise.resolve({sent:0,skipped:0,failed:0,deferred:0,unknown:0});
  if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
  running=Promise.resolve().then(run).finally(()=>{running=null;arm();});
  return running;
 }
 const worker={
  enqueue(items){
   if(closed)return false;
   let accepted=false;
   for(const input of Array.isArray(items)?items:[]){
    try{
     const entry=store.create(normalizeDecisionItem(input));
     if(entry.created||entry.state==='pending')accepted=true;
    }catch(error){report(error);}
   }
   if(accepted)wake();
   return accepted;
  },
  drain,
  recover(){wake();return worker.info();},
  pending(){return store.info().pending??0;},
  info(){return {states:store.info(),running:Boolean(running),scheduled,retryAt:store.nextAttemptAt(),timerActive:Boolean(retryTimer),closed};},
  close(){closed=true;if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}return running??Promise.resolve();},
 };
 if(store.nextAttemptAt()!==null)wake();
 return worker;
}
