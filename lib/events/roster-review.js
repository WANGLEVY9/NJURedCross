import {eventMailVariables} from '../mail/templates.js';
import {createHash, randomBytes} from 'node:crypto';
import {rosterReview, rosterRow, rosterMailKey, decodeRosterResult, encodeRosterResult, reviewTokenDigest} from '../../public/app/shared/roster-review.js';
import {validateSuccessMail,renderSuccessMail} from '../../public/app/shared/result-mail.js';
import {workflowConfig} from './blood-roster.js';
import {WORKFLOW_CONFIG_LIMIT} from './workflow-config-integrity.js';
import {isValidDeliveryEmail} from '../identity/mail-recipient.js';
import {inlineReview} from './roster-result-store.js';

const fail = (message, statusCode=409) => Object.assign(new Error(message), {statusCode});
// 报名页配置超限会被 NJUTable 静默截断，整行从此不可解析、报名通知整批停发。
// 写入前用与工作流一致的字符上限守住（见 workflow-config-integrity）。逐行结果
// 迁到独立表后，这个上限只用来兜住成功邮件模板之类的元信息。
export const CONFIG_LIMIT_CHARS = WORKFLOW_CONFIG_LIMIT;
export function assertConfigSize(config) {
  const encoded = JSON.stringify(config);
  if (encoded.length > CONFIG_LIMIT_CHARS) {
    throw fail('名单审核配置超过存储上限，请联系管理员检查成功邮件模板', 400);
  }
  return encoded;
}

/**
 * 配置超限时按「最旧的已发送投递记录优先」腾空间。
 * 已发送状态在「网站报名通知任务表」里有权威证据（statuses 兜底），删掉这些本地回执
 * 不会导致重发；sending / unknown / failed 一律保留，避免掩盖待核对的结果。
 * 投递回执迁到结果表后主路径不再需要它，保留给仍在使用旧格式的历史活动。
 */
export function trimDeliveries(base, review) {
  const deliveries = review?.deliveries;
  if (!deliveries || typeof deliveries !== 'object') return null;
  const entries = Object.entries(deliveries);
  const unsent = entries.filter(([, value]) => value?.status !== 'sent');
  const sent = entries.filter(([, value]) => value?.status === 'sent')
    .sort((left, right) => String(right[1]?.sentAt || '').localeCompare(String(left[1]?.sentAt || '')));
  for (const keep of [120, 60, 30, 10, 0]) {
    if (keep >= sent.length) continue;
    const next = { ...review, deliveries: Object.fromEntries([...unsent, ...sent.slice(0, keep)]) };
    if (JSON.stringify({ ...base, rosterReview: next }).length <= CONFIG_LIMIT_CHARS) return next;
  }
  return null;
}
const isResult = r => ['已确认','已签到','未入选'].includes(r['报名状态']);
const result = r => ({status:r['报名状态'],reason:r['处理说明'] || ''});
// 48 位随机串足够区分同一活动的每次结果变更，比 36 字符 UUID 省 24 字符/行。
const newVersion = () => randomBytes(6).toString('hex');
const ownRows = (data,event) => data.registrations.filter(r=>r['活动ID']===event['活动ID']);
// 指纹只取阶段与修订号：逐行结果可能上千条，跨活动算摘要会把一次列表请求放大成
// 整表扫描。任何结果变更都会让修订号递增，灵敏度与取全量一致。
export const rosterToken = (event,rows) => createHash('sha256').update(JSON.stringify([event['状态'],event['批准摘要'],reviewTokenDigest(rosterReview(event)),rows.filter(r=>r['活动ID']===event['活动ID']).map(r=>[r._id,r['报名状态'],r['处理说明'],r['请假状态'],r['签到照片ID'],r['签到行ID']]).sort((a,b)=>a[0].localeCompare(b[0]))])).digest('hex');
const decodeAll = (entries,rows) => Object.fromEntries(Object.entries(entries || {}).map(([id,raw]) =>
  [id, decodeRosterResult(raw, rows.find(row => row._id === id))]));

export function createRosterReview({read,write,update,WF,approved,resultStore,recipientFor=()=>'',authorizeRegistration=async()=>{}}) {
  async function context(id) {
    const data=await read(id),event=data.events.find(e=>e._id===id);
    if(!event)throw fail('活动不存在',404);
    const rows=ownRows(data,event);
    // 写入路径要靠报名行补齐结果表里的姓名学号；读取路径已把结果表合并进
    // rosterState，这里只在缺失时回落到配置里的元信息。
    event.rosterRows=rows;
    event.rosterState=event.rosterState??inlineReview(event);
    return {data,event,rows};
  }
  function assertOpen(event) {
    if(workflowConfig(event).source?.kind==='generated_blood')throw fail('源表排班不能使用整份名单再筛选');
    if(event['状态']!=='报名中'||!approved(event))throw fail('活动已关闭或审批状态改变');
  }
  function assertToken(event,rows,token) {
    if(!token||token!==rosterToken(event,rows))throw fail('名单已变化，请刷新后重新核对');
  }
  function initial(rows) {
    // Preserve outcomes already published through the previous workflow.
    return {phase:'draft',drafts:{},published:Object.fromEntries(rows.filter(isResult).map(r=>[r._id,result(r)])),deliveries:{}};
  }
  const REVIEW_META=['phase','successMail','actor','confirmedAt','closed','immediate','immediateCommit'];
  const metaOf = review => Object.fromEntries(REVIEW_META.filter(key=>review?.[key]!==undefined).map(key=>[key,review[key]]));
  async function save(event,review) {
    const base=workflowConfig(event);
    if(!resultStore) {
      // 结果表未装配（本地脚本、旧装配）：退回结果写配置，仍有 10000 字符上限，
      // 但语义正确、不会丢结果。超限时按最旧的已发送回执腾一次空间。
      let encoded;
      try{encoded=assertConfigSize({...base,rosterReview:review});}
      catch(error){const trimmed=trimDeliveries(base,review);if(!trimmed)throw error;review=trimmed;encoded=assertConfigSize({...base,rosterReview:review});}
      await update(WF.events,event,{报名页配置:encoded});
      event['报名页配置']=encoded;event.rosterState=review;
      return review;
    }
    const revision=Number(rosterReview(event)?.revision||0)+1;
    const meta={...metaOf(review),results:'table',revision};
    // 先写结果表再落元信息：results:'table' 是提交标记，若表没写成功而标记已落，
    // 这份结果就永久丢了；反过来表写了、元信息没落，重试会整份覆盖，代价只是白写一次。
    await resultStore.commit(event,review,event.rosterRows||[]);
    const encoded=assertConfigSize({...base,rosterReview:meta});
    await update(WF.events,event,{报名页配置:encoded});
    event['报名页配置']=encoded;
    event.rosterState={...review,...meta};
    return event.rosterState;
  }
  function protectedRow(data,row) {
    return row['报名状态']==='已签到'||row['签到照片ID']||row['签到行ID']||data.checkins.some(r=>r['报名行ID']===row._id)||data.ledger.some(r=>r['报名行ID']===row._id);
  }
  async function finishImmediate(event,rows,review) {
    for(const [id,next] of Object.entries(review.target)) {
      const row=rows.find(r=>r._id===id);
      if(!row)throw fail('审批中的报名记录缺失，请核对');
      const target=decodeRosterResult(next,row)||{};
      await update(WF.registrations,row,{报名状态:target.status,是否报名成功:target.status==='未入选'?'false':'true',处理说明:target.reason||''});
      Object.assign(row,{报名状态:target.status,处理说明:target.reason||''});
      delete review.drafts[id];
    }
    review={...review,phase:'draft',published:{...review.published,...decodeAll(review.target,rows)},target:undefined,immediateCommit:false};
    await save(event,review);
    return review;
  }
  const persistDelivery=(event,rowId,key,review) => resultStore
    ? resultStore.saveDelivery(event,rowId,key,review.deliveries[key])
    : save(event,review);
  return {
    saveSuccessMail: (id,template,token) => write(async()=>{
      const {event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      const review=rosterReview(event)||initial(rows);
      if(review.phase!=='draft'||review.confirmedAt)throw fail('名单已经确认，邮件内容已冻结');
      let checked;try{checked=validateSuccessMail(template);}catch(error){throw fail(error.message,400);}
      await save(event,{...review,successMail:checked});
    }),
    stageRoster: (id,ids,decision,reason,token,{immediate=false,actor}={}) => write(async()=>{
      const {data,event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      const regional=workflowConfig(event).approval?.mode==='workspace-regional';
      if(regional){await authorizeRegistration(event,actor);immediate=decision!=='reset';}
      if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||!['confirm','reject','reset'].includes(decision))throw fail('请选择1至100条不同报名及有效结果',400);
      const review=rosterReview(event)||initial(rows);
      if(review.phase!=='draft')throw fail('请先进入修改名单；正在提交的名单需先完成提交');
      const reasonText=typeof reason==='string'?reason.trim():'';
      if(reasonText.length>500||(decision==='reject'&&!reasonText))throw fail('请填写不超过500字的未录取原因',400);
      for(const id of ids){
        const row=rows.find(r=>r._id===id);
        if(!row||row['报名状态']==='已请假'||row['请假状态']==='待审批'||protectedRow(data,row))throw fail('报名存在请假、签到或时长记录，不能调整，请刷新核对');
        const savedDraft=review.drafts[id],publishingSaved=immediate&&savedDraft?.decision===decision&&(savedDraft.reason||'')===(decision==='reject'?reasonText:'');
        if(decision!=='reset'&&rosterRow(event,row)['报名状态']!=='待筛选'&&!publishingSaved)throw fail('请先撤销暂定结果，再重新选择');
        review.drafts[id]={decision,reason:decision==='reject'?reasonText:''};
      }
      const projected=rows.map(r=>rosterRow({...event,报名页配置:JSON.stringify({...workflowConfig(event),rosterReview:review})},r));
      if(projected.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length>Number(workflowConfig(event).registrationLimit??event['容量']))throw fail('拟录取人数超过报名上限');
      if(immediate&&['confirm','reject'].includes(decision)) {
        const version=newVersion(),target=Object.fromEntries(projected.filter(r=>ids.includes(r._id)).map(r=>{
          const previous=decodeRosterResult(review.published[r._id],rows.find(row=>row._id===r._id)),next=result(r);
          const unchanged=previous&&['已确认','已签到'].includes(previous.status)&&previous.reason===next.reason;
          return [r._id,encodeRosterResult({...next,version:unchanged?previous.version:version})];
        }));
        const intent={...review,phase:'publishing',immediate:true,immediateCommit:true,target,confirmedAt:review.confirmedAt||new Date().toISOString()};
        // Durable intent permits recovery without approving other pending volunteers.
        await save(event,intent);
        await finishImmediate(event,rows,intent);
      } else await save(event,review);
      return regional?{completed:ids,immediate}: {completed:ids};
    }),
    reopenRoster: (id,token) => write(async()=>{
      const {event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      const review=rosterReview(event);if(review?.phase!=='final')throw fail('只有已最终确认的名单可以重新调整');
      if(Object.values(review.deliveries||{}).some(s=>s.status==='sending'||s.status==='unknown'))throw fail('有邮件发送结果待核对，请先继续通知以核对发送记录');
      await save(event,{...review,phase:'draft',drafts:{}});
    }),
    finalizeRoster: (id,token,actor,{resumeOnly=false}={}) => write(async()=>{
      const {data,event,rows}=await context(id);assertOpen(event);assertToken(event,rows,token);
      let review=rosterReview(event)||initial(rows);
      if(review.immediateCommit){await finishImmediate(event,rows,review);return {finalized:false};}
      if(review.phase==='final')return {finalized:true};
      if(review.phase==='draft'){
        if(resumeOnly)throw fail('整份名单确认已取消，请逐条处理报名结果；截止报名请使用原截止操作');
        const projected=rows.map(r=>rosterRow(event,r));
        if(!projected.length||projected.some(r=>r['报名状态']==='待筛选'||r['请假状态']==='待审批'))throw fail('请先处理完所有待确认报名和请假申请');
        if(projected.some(r=>!isResult(r)&&r['报名状态']!=='已请假'))throw fail('存在未识别的报名状态，请核对名单');
        if(projected.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length>Number(workflowConfig(event).registrationLimit??event['容量']))throw fail('录取人数超过报名上限');
        const version=newVersion(),target={};
        for(const row of projected.filter(isResult)){
          const raw=rows.find(r=>r._id===row._id);
          const previous=decodeRosterResult(review.published[row._id],raw),next=result(row);
          const unchanged=previous&&(previous.status===next.status||['已确认','已签到'].includes(previous.status)&&['已确认','已签到'].includes(next.status))&&previous.reason===next.reason;
          if(!unchanged&&protectedRow(data,raw))throw fail('已有签到或时长记录的结果不能变更');
          // 只把真正变化的行写进提交意图：未变化的行在报名行与已发布结果里都已经是最终值，
          // 再写一遍会让一次确认变成整表写入——150 人的活动就是 150 行无谓的写请求。
          if(!unchanged)target[row._id]=encodeRosterResult({...next,version});
        }
        review={...review,phase:'publishing',closed:true,target,actor,confirmedAt:new Date().toISOString()};
        // 发布意图先落盘，中断后按同一份 target 续跑。published 保留上一版：结果已不在
        // 配置里，不必再为省空间清空它，发布过程中的展示也就不会露出写了一半的新结果。
        await save(event,review);
      }
      for(const [id,next] of Object.entries(review.target)){
        const row=rows.find(r=>r._id===id);if(!row)throw fail('提交名单中的报名记录缺失，请核对');
        const target=decodeRosterResult(next,row)||{};
        if(row['报名状态']!==target.status||row['处理说明']!==(target.reason||''))await update(WF.registrations,row,{报名状态:target.status,是否报名成功:target.status==='未入选'?'false':'true',处理说明:target.reason||''});
      }
      const published={...review.published,...decodeAll(review.target,rows)};
      await save(event,{...review,phase:'final',published,drafts:{},target:undefined});
      return {finalized:true};
    }),
    deliverRoster: (id,{send,statuses,retry=false}) => write(async()=>{
      const {event,rows}=await context(id);let review=rosterReview(event);
      if(event['状态']==='已归档')throw fail('活动已移除，不再发送报名结果');
      if(review?.immediateCommit)review=await finishImmediate(event,rows,review);
      if(review?.phase!=='final'&&!(review?.immediate&&review.phase==='draft'))throw fail('请先最终确认整份名单，暂定结果不能发送邮件');
      const recipients=rows.filter(r=>{
        const published=decodeRosterResult(review.published[r._id],r);
        return published&&!review.drafts?.[r._id]&&r['请假状态']!=='待审批'
          &&(published.status==='未入选'?r['报名状态']==='未入选':['已确认','已签到'].includes(r['报名状态']));
      });
      const keys=recipients.map(r=>rosterMailKey(r,review.published[r._id]));
      let evidence={};try{evidence=statuses?await statuses(keys):{};}catch{/* Durable local receipts remain authoritative. */}
      review.deliveries||={};
      if(retry)for(const key of keys)if(review.deliveries[key]?.status==='failed')review.deliveries[key]={status:'not_sent'};
      let sent=0,attempted=0;const failed=[],unknown=[];
      for(const row of recipients){
        const published=decodeRosterResult(review.published[row._id],row)||{},key=rosterMailKey(row,review.published[row._id]),old=review.deliveries[key];
        if(old?.status==='sent'||evidence[key]?.status==='sent'){review.deliveries[key]={status:'sent',sentAt:old?.sentAt||evidence[key]?.sentAt||''};continue;}
        if(evidence[key]?.blocked){review.deliveries[key]={status:'unknown'};unknown.push(row._id);continue;}
        if(evidence[key]?.deferred)continue;
        if((old?.status==='sending'||old?.status==='unknown')&&evidence[key]?.retryable!==true){review.deliveries[key]={status:'unknown'};unknown.push(row._id);continue;}
        if(old?.status==='failed'&&!retry){failed.push(row._id);continue;}
        if(attempted>=10)continue;
        // Persist the intent before SMTP; uncertain crash recovery never blindly resends.
        review.deliveries[key]={status:'sending'};await persistDelivery(event,row._id,key,review);attempted++;
        const success=published.status!=='未入选';let delivery;
        const recipient=recipientFor(row);
        try{delivery=await send({to:isValidDeliveryEmail(recipient)?recipient.trim():row['邮箱'],subject:`南大红会｜${event['活动名称']}报名结果`,text:`${row['姓名']}同学：\n你报名的${event['活动名称']}：${success?'报名成功':'报名失败'}。\n${published.reason||(success?'请按时参加活动。':'感谢你的参与。')}\n请登录平台查看详情。`,...(success&&review.successMail?renderSuccessMail(review.successMail,event,row):{}),templateId:success?'registration-success':'registration-result',templateVariables:eventMailVariables(event,row),kind:'workflow-result',idempotencyKey:key});}catch{delivery={ok:false};}
        const ok=delivery?.ok&&delivery.transport!=='console';
        review.deliveries[key]={status:ok?'sent':'failed',sentAt:ok?new Date().toISOString():''};
        await persistDelivery(event,row._id,key,review);if(ok)sent++;else failed.push(row._id);
      }
      await save(event,review);
      const states=keys.map(key=>review.deliveries[key]?.status||'not_sent');
      return {sent,failed,unknown,total:keys.length,delivered:states.filter(s=>s==='sent').length,remaining:states.filter(s=>s==='not_sent').length,failedCount:states.filter(s=>s==='failed').length};
    }),
  };
}
