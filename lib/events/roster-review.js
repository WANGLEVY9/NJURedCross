import {createHash, randomUUID} from 'node:crypto';
import {rosterReview, rosterRow, rosterMailKey} from '../../public/app/shared/roster-review.js';
import {workflowConfig} from './blood-roster.js';

const fail = (message, statusCode=409) => Object.assign(new Error(message), {statusCode});
const isResult = r => ['已确认','已签到','未入选'].includes(r['报名状态']);
const result = r => ({status:r['报名状态'],reason:r['处理说明'] || ''});
const ownRows = (data,event) => data.registrations.filter(r=>r['活动ID']===event['活动ID']);
export const rosterToken = (event,rows) => createHash('sha256').update(JSON.stringify([event['状态'],event['批准摘要'],rosterReview(event),rows.filter(r=>r['活动ID']===event['活动ID']).map(r=>[r._id,r['报名状态'],r['处理说明'],r['请假状态'],r['签到照片ID'],r['签到行ID']]).sort((a,b)=>a[0].localeCompare(b[0]))])).digest('hex');

export function createRosterReview({read,write,update,WF,approved}) {
  async function context(id) {
    const data=await read(),event=data.events.find(e=>e._id===id);
    if(!event)throw fail('活动不存在',404);
    return {data,event,rows:ownRows(data,event)};
  }
  function assertOpen(event) {
    if(event['状态']!=='报名中'||!approved(event))throw fail('活动已关闭或审批状态改变');
  }
  function assertToken(event,rows,token) {
    if(!token||token!==rosterToken(event,rows))throw fail('名单已变化，请刷新后重新核对');
  }
  function initial(rows) {
    // Preserve outcomes already published through the previous workflow.
    return {phase:'draft',drafts:{},published:Object.fromEntries(rows.filter(isResult).map(r=>[r._id,result(r)])),deliveries:{}};
  }
  async function save(event,review) {
    const config={...workflowConfig(event),rosterReview:review};
    await update(WF.events,event,{报名页配置:JSON.stringify(config)});
    event['报名页配置']=JSON.stringify(config);
  }
  function protectedRow(data,row) {
    return row['报名状态']==='已签到'||row['签到照片ID']||row['签到行ID']||data.checkins.some(r=>r['报名行ID']===row._id)||data.ledger.some(r=>r['报名行ID']===row._id);
  }
  return {
    stageRoster: (id,ids,decision,reason,token) => write(async()=>{
      const {data,event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||!['confirm','reject','reset'].includes(decision))throw fail('请选择1至100条不同报名及有效结果',400);
      const review=rosterReview(event)||initial(rows);
      if(review.phase!=='draft')throw fail('请先进入修改名单；正在提交的名单需先完成提交');
      const reasonText=typeof reason==='string'?reason.trim():'';
      if(reasonText.length>500||(decision==='reject'&&!reasonText))throw fail('请填写不超过500字的未录取原因',400);
      for(const id of ids){
        const row=rows.find(r=>r._id===id);
        if(!row||row['报名状态']==='已请假'||row['请假状态']==='待审批'||protectedRow(data,row))throw fail('报名存在请假、签到或时长记录，不能调整，请刷新核对');
        if(decision!=='reset'&&rosterRow(event,row)['报名状态']!=='待筛选')throw fail('请先撤销暂定结果，再重新选择');
        review.drafts[id]={decision,reason:decision==='reject'?reasonText:''};
      }
      const projected=rows.map(r=>rosterRow({...event,报名页配置:JSON.stringify({...workflowConfig(event),rosterReview:review})},r));
      if(projected.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length>Number(workflowConfig(event).registrationLimit??event['容量']))throw fail('拟录取人数超过报名上限');
      await save(event,review);return {completed:ids};
    }),
    reopenRoster: (id,token) => write(async()=>{
      const {event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      const review=rosterReview(event);if(review?.phase!=='final')throw fail('只有已最终确认的名单可以重新调整');
      if(Object.values(review.deliveries||{}).some(s=>s.status==='sending'||s.status==='unknown'))throw fail('有邮件发送结果待核对，请先继续通知以核对发送记录');
      await save(event,{...review,phase:'draft',drafts:{}});
    }),
    finalizeRoster: (id,token,actor) => write(async()=>{
      const {data,event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      let review=rosterReview(event)||initial(rows);
      if(review.phase==='final')return {finalized:true};
      if(review.phase==='draft'){
        const projected=rows.map(r=>rosterRow(event,r));
        if(!projected.length||projected.some(r=>r['报名状态']==='待筛选'||r['请假状态']==='待审批'))throw fail('请先处理完所有待确认报名和请假申请');
        if(projected.some(r=>!isResult(r)&&r['报名状态']!=='已请假'))throw fail('存在未识别的报名状态，请核对名单');
        if(projected.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length>Number(workflowConfig(event).registrationLimit??event['容量']))throw fail('录取人数超过报名上限');
        const version=randomUUID(),target={};
        for(const row of projected.filter(isResult)){
          const previous=review.published[row._id],next=result(row);
          const unchanged=previous&&(previous.status===next.status||['已确认','已签到'].includes(previous.status)&&['已确认','已签到'].includes(next.status))&&previous.reason===next.reason;
          const raw=rows.find(r=>r._id===row._id);
          if(!unchanged&&protectedRow(data,raw))throw fail('已有签到或时长记录的结果不能变更');
          target[row._id]={...next,version:unchanged?previous.version:version};
        }
        review={...review,phase:'publishing',closed:true,target,actor,confirmedAt:new Date().toISOString()};
        // Freeze the complete target before row writes. A retry resumes this same commit.
        await save(event,review);
      }
      for(const [id,next] of Object.entries(review.target)){
        const row=rows.find(r=>r._id===id);if(!row)throw fail('提交名单中的报名记录缺失，请核对');
        if(row['报名状态']!==next.status||row['处理说明']!==next.reason)await update(WF.registrations,row,{报名状态:next.status,是否报名成功:next.status==='未入选'?'false':'true',处理说明:next.reason});
      }
      const published=review.target;
      await save(event,{...review,phase:'final',published,drafts:{},target:undefined});
      return {finalized:true};
    }),
    deliverRoster: (id,{send,statuses,retry=false}) => write(async()=>{
      const {event,rows}=await context(id),review=rosterReview(event);
      if(review?.phase!=='final')throw fail('请先最终确认整份名单，暂定结果不能发送邮件');
      const recipients=rows.filter(r=>review.published[r._id]);
      const keys=recipients.map(r=>rosterMailKey(r,review.published[r._id]));
      let evidence={};try{evidence=statuses?await statuses(keys):{};}catch{/* Durable local receipts remain authoritative. */}
      review.deliveries||={};
      if(retry)for(const key of keys)if(review.deliveries[key]?.status==='failed')review.deliveries[key]={status:'not_sent'};
      let sent=0,attempted=0;const failed=[],unknown=[];
      for(const row of recipients){
        const published=review.published[row._id],key=rosterMailKey(row,published),old=review.deliveries[key];
        if(old?.status==='sent'||evidence[key]?.status==='sent'){review.deliveries[key]={status:'sent',sentAt:old?.sentAt||evidence[key]?.sentAt||''};continue;}
        if(old?.status==='sending'||old?.status==='unknown'){review.deliveries[key]={status:'unknown'};unknown.push(row._id);continue;}
        if(old?.status==='failed'&&!retry){failed.push(row._id);continue;}
        if(attempted>=10)continue;
        // Persist the intent before SMTP; uncertain crash recovery never blindly resends.
        review.deliveries[key]={status:'sending'};await save(event,review);attempted++;
        const success=published.status!=='未入选';let delivery;
        try{delivery=await send({to:row['邮箱'],subject:`南大红会｜${event['活动名称']}报名结果`,text:`${row['姓名']}同学：\n你报名的${event['活动名称']}：${success?'报名成功':'报名失败'}。\n${published.reason||(success?'请按时参加活动。':'感谢你的参与。')}\n请登录平台查看详情。`,kind:'workflow-result',idempotencyKey:key});}catch{delivery={ok:false};}
        const ok=delivery?.ok&&delivery.transport!=='console';
        review.deliveries[key]={status:ok?'sent':'failed',sentAt:ok?new Date().toISOString():''};
        await save(event,review);if(ok)sent++;else failed.push(row._id);
      }
      await save(event,review);
      const states=keys.map(key=>review.deliveries[key]?.status||'not_sent');
      return {sent,failed,unknown,total:keys.length,delivered:states.filter(s=>s==='sent').length,remaining:states.filter(s=>s==='not_sent').length,failedCount:states.filter(s=>s==='failed').length};
    }),
  };
}
