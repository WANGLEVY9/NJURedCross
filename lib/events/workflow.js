import { readPagedRows } from '../http/paged-rows.js';
import { syncBloodBooking } from './blood-booking.js';
import { sourceText, bloodSourceOccupied, generatedBloodEvents } from './blood-source.js';
import { displayRead } from '../http/display-reads.js';
/** Isolated workflow. Dedicated tables keep legacy incremental scripts out. */
import { createHash, randomUUID } from 'node:crypto';
import { sourceActivities } from './catalog.js';
import { ACTIVITY_TEMPLATES } from '../../public/app/shared/activity-templates.js';
import { previewHoursExport } from './hours-export.js';
import { createMutationQueue } from './safety.js';
import { bloodRosterDrafts, workflowConfig, BLOOD_POINTS, BLOOD_SHIFTS, rosterTimes } from './blood-roster.js';
export { TEST_WORKFLOW_BASE } from './workflow-mode.js';
export const WORKFLOW_SCHEMA = [
  { name: '网站活动流程表', columns: ['活动ID','活动名称','活动类别','负责人账号ID','申请版本','批准版本','批准摘要','审批人','审批时间','状态','报名日期','报名时段','岗位','容量','服务时长','培训时长','交通时长','地点','工作内容','通知草稿','报名页配置','准备状态','创建时间','停点说明','归档前状态'] },
  { name: '网站活动报名总表', columns: ['活动名称','活动类别','报名ID','活动ID','账号ID','学号','姓名','邮箱','院系','报名日期','报名时段','岗位','报名状态','是否报名成功','志愿时长','录入状态','签到行ID','创建时间','请假状态','请假原因','请假申请时间','处理说明','签到照片ID','签到提交时间','报名类型','校区','岗位源行ID','岗位同步状态'] },
  { name: '网站活动签到表', columns: ['签到ID','报名行ID','活动ID','账号ID','学号','姓名','活动时间','核验人','核验说明'] },
  { name: '网站服务时长明细表', columns: ['幂等键','报名行ID','签到行ID','活动ID','账号ID','学号','姓名','规则版本','服务时长','培训时长','交通时长','状态','核对人','批准人','批准时间','来源摘要','入账时间'] },
  { name: '网站志愿时长汇总表', columns: ['账号ID','学号','姓名','服务时长','培训时长','交通时长','明细摘要','更新时间'] },
  { name: '网站个人主页表', columns: ['账号ID','学号','姓名','邮箱','志愿时长','培训时长','交通时长','明细摘要','更新时间'] },
];
export const WF = Object.freeze(Object.fromEntries(['events','registrations','checkins','ledger','summaries','profiles'].map((key,index)=>[key,WORKFLOW_SCHEMA[index].name])));
const fail = (statusCode, message, code = 'workflow_conflict') => Object.assign(new Error(message), { statusCode, code });
const str = value => typeof value === 'string' ? value.trim() : '';
function number(value, label, { positive = false, integer = false } = {}) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') throw fail(400, `${label}格式无效`);
  const n=Number(value);if(!Number.isFinite(n)||n<0||(positive&&n===0)||(integer&&!Number.isInteger(n))||n>100000)throw fail(400,`${label}超出有效范围`);return n;
}
function required(value,label){const v=str(value);if(!v||v.length>500)throw fail(400,`${label}不能为空或过长`);return v;}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const workflowApprovalHash = row => digest(['活动ID','活动名称','活动类别','负责人账号ID','申请版本','报名日期','报名时段','岗位','容量','服务时长','培训时长','交通时长','地点','工作内容','通知草稿','报名页配置','准备状态'].map(key=>row[key]||''));
export const workflowEventApproved = row => row['批准版本']===row['申请版本']&&row['批准摘要']===workflowApprovalHash(row);
const hoursDigest=(source,amounts)=>digest([source,...['服务时长','培训时长','交通时长'].map(key=>Number(amounts[key]))]);
function ledgerEvidenceMatches(row,source,event){
 if(['服务时长','培训时长','交通时长'].some(key=>!Number.isFinite(Number(row[key]))||Number(row[key])<0)||Number(row['服务时长'])<=0)return false;
 return row['来源摘要']===hoursDigest(source,row)||(row['来源摘要']===source&&['服务时长','培训时长','交通时长'].every(key=>Number(row[key])===Number(event[key])));
}
const at = () => new Date().toISOString();
const value = object => Object.fromEntries(Object.entries(object).map(([key,item])=>[key,String(item??'')]));
export async function workflowRows(base, table, ttlMs = 5_000) {
  return displayRead(base, JSON.stringify(['workflowRows', table]), () => loadWorkflowRows(base, table), ttlMs);
}
async function loadWorkflowRows(base, table) {
  return readPagedRows(base, table, { maxRows: 100000, requireComplete: true });
}
function one(rows,predicate,label,{optional=false}={}){const found=rows.filter(predicate);if(found.length>1)throw fail(409,`${label}出现重复，需对账`);if(!found.length&&!optional)throw fail(404,`${label}不存在`);return found[0];}
function snapshot(event,row,checkin){return digest([event['活动ID'],event['申请版本'],event['批准版本'],event['服务时长'],event['培训时长'],event['交通时长'],event['报名日期'],event['报名时段'],event['岗位'],event['容量'],event['地点'],event['工作内容'],row['账号ID'],row['学号'],row['姓名'],row['报名日期'],row['报名时段'],row['岗位'],row['报名状态'],row['是否报名成功'],checkin._id,checkin['报名行ID'],checkin['学号'],checkin['账号ID'],checkin['核验人'],checkin['核验说明'],checkin['活动时间'],...(workflowConfig(event).blood?[row['签到照片ID'],row['签到提交时间']]:[])]);}
export function createWorkflow(base,{assertWritable=()=>{},onStep=async()=>{},now=()=>Date.now(),bloodSourceTable=null,mode='test'}={}) {
  const serial=createMutationQueue();
  async function eventRows(){
    const stored=await workflowRows(base,WF.events);
    if(!bloodSourceTable)return stored;
    const [sourceRows,websiteRows]=await Promise.all([workflowRows(base,bloodSourceTable,60_000),workflowRows(base,WF.registrations)]);
    const ownedCodes=new Set(websiteRows.filter(r=>['待筛选','已确认','已签到'].includes(r['报名状态'])).map(r=>r['报名ID']));
    const generated=generatedBloodEvents(sourceRows,now(),ownedCodes);
    for(const row of generated){const c=workflowConfig(row);c.source.table=bloodSourceTable;c.sourceActivityIds=stored.filter(e=>workflowConfig(e).blood?.key===c.blood.key).map(e=>e['活动ID']);row['报名页配置']=JSON.stringify(c);row['批准摘要']=workflowApprovalHash(row);}
    const keys=new Set(generated.map(row=>workflowConfig(row).blood.key));
    return [...stored.map(row=>keys.has(workflowConfig(row).blood?.key)?{...row,sourceSuperseded:true}:row),...generated];
  }
  async function syncPosition(event,row,state='待审核'){if(mode!=='production'||workflowConfig(event).source?.kind!=='generated_blood')return;const sourceId=await syncBloodBooking(base,bloodSourceTable,event,row,state);await update(WF.registrations,row,{岗位源行ID:sourceId||row['岗位源行ID']||'',岗位同步状态:state==='可报名'?'已释放':'已同步'});}
  async function read(){const sets=await Promise.all(Object.entries(WF).map(([key,name])=>key==='events'?eventRows():workflowRows(base,name)));return Object.fromEntries(Object.keys(WF).map((key,index)=>[key,sets[index]]));}
  // Display snapshots only need three tables. Mutation evidence still uses fresh read().
  async function overview(){const keys=['events','registrations','ledger'];const sets=await Promise.all(keys.map(key=>key==='events'?eventRows():workflowRows(base,WF[key])));return Object.fromEntries(keys.map((key,index)=>[key,sets[index]]));}
  async function write(task){assertWritable();return serial(task);}
  async function append(table,row){const result=await base.appendRow(table,value(row));if(!result?._id)throw fail(502,'流程写入结果不完整，请刷新对账后重试');return {...value(row),_id:result._id};}
  const update=(table,row,patch)=>{if(table===WF.events&&workflowConfig(row).source?.kind==='generated_blood')throw fail(409,'献血车班次由排班表维护，请在 NJUTable 调整');return base.updateRow(table,row._id,value(patch));};
  async function eventBy(id){return one(await eventRows(),row=>row._id===id||row['活动ID']===id,'活动');}
  async function evidence(id){const data=await read();const registration=one(data.registrations,row=>row._id===id,'报名');const event=one(data.events,row=>row['活动ID']===registration['活动ID'],'活动');const checkin=one(data.checkins,row=>row._id===registration['签到行ID']&&row['报名行ID']===id,'签到');
    if(registration['是否报名成功']!=='true'||registration['报名状态']!=='已签到'||!checkin['核验人']||!checkin['核验说明']||checkin['学号']!==registration['学号']||checkin['账号ID']!==registration['账号ID']||checkin['活动ID']!==event['活动ID']||!workflowEventApproved(event))throw fail(409,'名单、审批或签到证据不一致');
    if(workflowConfig(event).blood&&(!registration['签到照片ID']||!registration['签到提交时间']))throw fail(409,'献血车签到照片证据缺失');
    return {data,registration,event,checkin,sourceHash:snapshot(event,registration,checkin)};
  }
  async function mirror(accountId){
    const data=await read();const rows=data.ledger.filter(row=>row['账号ID']===accountId&&['已批准','已入账'].includes(row['状态']));
    if(!rows.length)throw fail(409,'没有已批准时长');
    for(const row of rows){const source=await evidence(row['报名行ID']);if(!ledgerEvidenceMatches(row,source.sourceHash,source.event))throw fail(409,'已批准明细来源或时长改变，停止对账');}
    const ids=new Set();const identities=new Set();
    for(const row of rows){if(ids.has(row['幂等键']))throw fail(409,'重复时长明细，停止对账');ids.add(row['幂等键']);identities.add(JSON.stringify([row['学号'],row['姓名']]));}
    if(identities.size!==1)throw fail(409,'时长明细身份冲突');
    const sum=key=>number(rows.reduce((total,row)=>total+number(row[key],key),0),`累计${key}`);
    const hours=sum('服务时长'),training=sum('培训时长'),travel=sum('交通时长');
    const checksum=digest(rows.map(row=>[row['幂等键'],row['服务时长'],row['培训时长'],row['交通时长']]).sort((a,b)=>a[0].localeCompare(b[0])));
    const first=rows[0],registration=one(data.registrations,row=>row._id===first['报名行ID'],'报名');
    const common={账号ID:accountId,学号:first['学号'],姓名:first['姓名'],培训时长:training,交通时长:travel,明细摘要:checksum,更新时间:at()};
    // Absolute recomputation: a half-success retry writes the same totals, never +hours.
    for(const [table,existing,patch,step] of [[WF.summaries,data.summaries,{...common,服务时长:hours},'summary'],[WF.profiles,data.profiles,{...common,邮箱:registration['邮箱'],志愿时长:hours},'profile']]){
      const target=one(existing,row=>row['账号ID']===accountId,'时长镜像',{optional:true});
      if(target){if(target['学号']!==first['学号']||target['姓名']!==first['姓名'])throw fail(409,'时长镜像身份冲突');await update(table,target,patch);}else await append(table,patch);
      await onStep(step);
    }
    for(const row of rows){if(row['状态']!=='已入账')await update(WF.ledger,row,{状态:'已入账',入账时间:at()});const r=one(data.registrations,item=>item._id===row['报名行ID'],'报名');await update(WF.registrations,r,{录入状态:'网站已入账',志愿时长:row['服务时长']});await onStep('registration');}
    return {accountId,serviceHours:hours,trainingHours:training,travelHours:travel,ledgerCount:rows.length,checksum};
  }
  function prepare(body){
      const title=required(body.name,'活动名称'),date=required(body.date,'报名日期');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw fail(400,'日期格式无效');
      const config={name:title,date,slot:required(body.slot,'时段'),position:required(body.position,'岗位'),capacity:number(body.capacity,'容量',{positive:true,integer:true}),service:number(body.serviceHours,'服务时长',{positive:true}),training:number(body.trainingHours??1,'培训时长'),travel:number(body.travelHours??1,'交通时长'),location:required(body.location,'地点'),work:required(body.work,'工作内容')};
      const template=ACTIVITY_TEMPLATES.find(t=>t.id===(body.templateId||'general'));if(!template)throw fail(400,'活动模板不存在');
      config.templateId=template.id;
      if(body.recommended!==undefined&&body.recommended!==''){config.recommended=number(body.recommended,'推荐人数',{positive:true,integer:true});if(config.recommended>config.capacity)throw fail(400,'推荐人数不能超过报名上限');}
      if(body.blood)config.blood=body.blood;
      else if(template.id==='blood_vehicle'){
        if(!BLOOD_POINTS.includes(config.location)||!BLOOD_SHIFTS.includes(config.slot))throw fail(400,'献血车点位或班次不符合现有模板');
        const week=number(body.week,'周次',{positive:true,integer:true});config.blood={mode:'blood_vehicle',week,key:`${date}|${config.location}|${config.slot}`,...rosterTimes(date,config.slot)};
      }
      if(body.source)config.source=body.source;
      return {活动名称:title,活动类别:config.blood?'献血车志愿服务':required(body.category||template.category,'类别'),报名日期:date,报名时段:config.slot,岗位:config.position,容量:config.capacity,服务时长:config.service,培训时长:config.training,交通时长:config.travel,地点:config.location,工作内容:config.work,通知草稿:`${title}\n${date} ${config.slot}\n地点：${config.location}\n岗位：${config.position}；容量：${config.capacity}\n工作：${config.work}`,报名页配置:JSON.stringify(config),准备状态:'已准备'};
  }
  function assertPrepared(event){
    const c=workflowConfig(event);if(event['准备状态']!=='已准备'||!c||typeof c!=='object')throw fail(409,'请先完善活动配置');
    if(c.blood){const expected=rosterTimes(event['报名日期'],event['报名时段']);if(!BLOOD_POINTS.includes(event['地点'])||!BLOOD_SHIFTS.includes(event['报名时段'])||c.blood.mode!=='blood_vehicle'||c.blood.start!==expected.start||c.blood.end!==expected.end||c.blood.key!==`${event['报名日期']}|${event['地点']}|${event['报名时段']}`)throw fail(409,'献血车班次配置不一致');}
    const pairs={name:'活动名称',date:'报名日期',slot:'报名时段',position:'岗位',capacity:'容量',service:'服务时长',training:'培训时长',travel:'交通时长',location:'地点',work:'工作内容'};
    if(Object.entries(pairs).some(([key,column])=>String(c[key]??'')!==String(event[column]??'')))throw fail(409,'表格配置与报名配置不一致，请重新编辑保存');
    prepare({name:c.name,date:c.date,slot:c.slot,position:c.position,capacity:c.capacity,serviceHours:c.service,trainingHours:c.training,travelHours:c.travel,location:c.location,work:c.work,templateId:c.templateId,blood:c.blood,source:c.source,recommended:c.recommended});
  }
  async function createEvent(body,actor){const prepared=prepare(body);const blood=workflowConfig(prepared).blood;if(blood&&(await workflowRows(base,WF.events)).some(e=>workflowConfig(e).blood?.key===blood.key))throw fail(409,'该日期点位班次已存在，请编辑原班次或先从回收站恢复');return append(WF.events,eventDraft(prepared,body,actor));}
  function eventDraft(prepared,body,actor){return {...prepared,活动ID:`WF-${randomUUID()}`,负责人账号ID:actor,申请版本:1,批准版本:'',状态:body.submit===false?'草稿':'待审核',创建时间:at()};}
  async function sources(managed=[]){const meta=await base.getMetadata();const tables=new Set(meta.tables.map(t=>t.name));const rows=await Promise.all(['活动报名总表','登记审批'].map(t=>tables.has(t)?workflowRows(base,t):[]));return sourceActivities(rows[0],rows[1],managed);}
  async function verifyAttendance(id,actor,note){const data=await read();const row=one(data.registrations,r=>r._id===id,'报名');if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');if(row['报名状态']!=='已确认')throw fail(409,'仅已确认名单可以签到');const event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');if(!workflowEventApproved(event)||event['状态']!=='报名中')throw fail(409,'活动审批或开放状态已改变');if(workflowConfig(event).blood&&!row['签到照片ID'])throw fail(409,'献血车签到需先提交带日期时间的现场照片');const why=required(note,'现场核验说明');const existing=one(data.checkins,r=>r['报名行ID']===id,'签到',{optional:true});const check=existing||await append(WF.checkins,{签到ID:`WC-${randomUUID()}`,报名行ID:id,活动ID:row['活动ID'],账号ID:row['账号ID'],学号:row['学号'],姓名:row['姓名'],活动时间:at(),核验人:actor,核验说明:why});await update(WF.registrations,row,{报名状态:'已签到',签到行ID:check._id});return check;}
  async function makeHours(id,actor,overrides={}){const {data,registration:r,event:e,checkin:c,sourceHash}=await evidence(id);const amounts=Object.fromEntries([['服务时长','serviceHours'],['培训时长','trainingHours'],['交通时长','travelHours']].map(([column,key])=>[column,number(overrides[key]??e[column],column,{positive:column==='服务时长'})]));const key=`SERVICE:${r._id}`;const existing=one(data.ledger,row=>row['幂等键']===key,'时长明细',{optional:true});if(existing){if(!ledgerEvidenceMatches(existing,sourceHash,e))throw fail(409,'源数据已改变，不能覆盖既有明细');if(Object.keys(overrides).length&&Object.keys(amounts).some(key=>Number(existing[key])!==amounts[key]))throw fail(409,'已有时长草稿与本次数值不同，请核对原记录');return existing;}
      return append(WF.ledger,{幂等键:key,报名行ID:r._id,签到行ID:c._id,活动ID:r['活动ID'],账号ID:r['账号ID'],学号:r['学号'],姓名:r['姓名'],规则版本:e['申请版本'],...amounts,状态:'待批准',核对人:actor,来源摘要:hoursDigest(sourceHash,amounts)});}
  return {
    read,
    publicRead: async () => {
      const [events, registrations] = await Promise.all([eventRows(), workflowRows(base, WF.registrations)]);
      return { events, registrations };
    },
    overview,
    positions:async id=>{
      const event=await eventBy(id);if(!bloodSourceTable||workflowConfig(event).source?.kind!=='generated_blood')return [];
      const rows=(await workflowRows(base,bloodSourceTable)).filter(r=>String(r['日期']||'').slice(0,10)===event['报名日期']&&r['点位']===event['地点']&&r['活动时间']===event['报名时段']);
      return Promise.all(rows.map(async(r,index)=>{
        let profile={...r,姓名:sourceText(r['姓名'])||sourceText(r['姓名2'])||sourceText(r['报名人']),学号:sourceText(r['学号'])||sourceText(r['学号2'])};const studentId=profile['学号'];
        if(base.query&&/^\d{6,20}$/.test(studentId)){const matches=await base.query(`SELECT * FROM \`个人主页（编辑版）\` WHERE \`学号\` = '${studentId}' LIMIT 3`);if(Array.isArray(matches)&&matches.length===1&&sourceText(matches[0]['学号'])===studentId&&sourceText(matches[0]['姓名'])===profile['姓名'])profile={...profile,...matches[0]};}
        return {position:index+1,status:['停点','已停点'].includes(r['报名结果'])?'停点':bloodSourceOccupied(r)?sourceText(r['报名结果'])||'已占用':'可报名',profile:Object.fromEntries(['姓名','学号','邮箱','手机号','院系','年级','校区','性别','所属部门','急救资质','总志愿时长'].map(key=>[key,sourceText(profile[key])]))};
      }));
    },
    sources,
    adopt: (sourceKey,body,actor,managed=[])=>write(async()=>{
      if(body.blood||body.source)throw fail(400,'不能覆盖来源关联');
      const source=one(await sources(managed),r=>r.key===sourceKey,'源活动');
      const existing=one(await workflowRows(base,WF.events),e=>workflowConfig(e).source?.key===sourceKey,'源活动映射',{optional:true});if(existing)return existing;
      return createEvent({...body,source:{key:source.key,table:source.table,id:source.sourceId,hash:source.sourceHash},submit:false},actor);
    }),
    edit: (id,body,actor)=>write(async()=>{const data=await read(),event=one(data.events,e=>e._id===id||e['活动ID']===id,'活动');
      if(['报名中','已结束','停点','已归档'].includes(event['状态'])||data.registrations.some(r=>r['活动ID']===event['活动ID']))throw fail(409,'已有参与记录或已发布的活动不能改写配置');
      if(body.blood||body.source)throw fail(400,'不能覆盖来源或排班关联');
      const old=workflowConfig(event),prepared=prepare({...body,source:old.source});
      if(old.blood&&JSON.parse(prepared['报名页配置']).blood?.key!==old.blood.key)throw fail(409,'班次日期点位不能修改，请新建班次');
      await update(WF.events,event,{...prepared,负责人账号ID:required(actor,'变更提交者'),申请版本:Number(event['申请版本']||0)+1,批准版本:'',批准摘要:'',审批人:'',审批时间:'',状态:'草稿'});
    }),
    editNotice: (id,text,actor)=>write(async()=>{const event=await eventBy(id);if(!['草稿','待审核','可发布'].includes(event['状态']))throw fail(409,'仅未发布活动可以编辑通知');const content=str(text);if(!content||content.length>5000)throw fail(400,'通知不能为空或超过5000字');await update(WF.events,event,{通知草稿:content,负责人账号ID:required(actor,'通知提交者'),申请版本:Number(event['申请版本']||0)+1,批准版本:'',批准摘要:'',审批人:'',审批时间:'',状态:'草稿'});}),
    submit: id=>write(async()=>{const event=await eventBy(id);if(!['草稿','待配置'].includes(event['状态'])||event['准备状态']!=='已准备'||!event['报名页配置'])throw fail(409,'请先补全活动配置并保存');assertPrepared(event);await update(WF.events,event,{状态:'待审核'});}),
    archive: id=>write(async()=>{const data=await read(),event=one(data.events,e=>e._id===id||e['活动ID']===id,'活动');if(data.registrations.some(r=>r['活动ID']===event['活动ID'])||data.ledger.some(r=>r['活动ID']===event['活动ID']))throw fail(409,'已有参与记录，不能删除；请结束活动并保留记录');if(event['状态']==='已归档')throw fail(409,'已在回收站');await update(WF.events,event,{归档前状态:event['状态'],状态:'已归档'});}),
    restore: id=>write(async()=>{const event=await eventBy(id);if(event['状态']!=='已归档')throw fail(409,'活动不在回收站');await update(WF.events,event,{状态:['可发布','报名中'].includes(event['归档前状态'])&&workflowEventApproved(event)?event['归档前状态']:'草稿'});}),
    close: id=>write(async()=>{const event=await eventBy(id);if(!['报名中','停点'].includes(event['状态']))throw fail(409,'仅开放或停点活动可结束');await update(WF.events,event,{状态:'已结束'});}),
    prepareBloodWeek: (body,actor)=>write(async()=>{
      if(bloodSourceTable)throw fail(409,'献血车班次由 NJUTable 自动生成，无需手动排班');
      const drafts=bloodRosterDrafts(await workflowRows(base,'市血液献血车排班表（模板表）'),body);
      // Validate every amount before any durable write.
      number(body.capacity,'容量',{positive:true,integer:true});number(body.serviceHours,'服务时长',{positive:true});number(body.trainingHours??0,'培训时长');number(body.travelHours??0,'交通时长');
      const existing=await workflowRows(base,WF.events),result=[],missing=[];
      // Validate all configurations and conflicts before the first write.
      for(const draft of drafts){draft.submit=body.submit;draft.templateId='blood_vehicle';const prepared=prepare(draft);const found=one(existing,e=>workflowConfig(e).blood?.key===draft.blood.key,'排班',{optional:true});
        if(found){const c=workflowConfig(found);if(Number(c.capacity)!==Number(draft.capacity)||Number(c.service)!==Number(draft.serviceHours)||Number(c.training)!==Number(draft.trainingHours)||Number(c.travel)!==Number(draft.travelHours)||c.blood.week!==draft.blood.week)throw fail(409,'该周排班已有不同规则，请人工校对');result.push(found);}
        else{const row=eventDraft(prepared,draft,actor);missing.push(row);result.push(row);}}
      if(missing.length){
        if(typeof base.batchAppendRows==='function'){
          await base.batchAppendRows(WF.events,missing.map(value));
          // Resolve persisted row IDs by activity ID, without relying on SDK response order.
          const saved=await workflowRows(base,WF.events);
          for(let index=0;index<result.length;index++)if(!result[index]._id){
            const intended=result[index];const row=one(saved,e=>e['活动ID']===intended['活动ID'],'新班次');
            if(workflowApprovalHash(row)!==workflowApprovalHash(value(intended))||row['状态']!==intended['状态'])throw fail(502,'排班写入结果不一致，请刷新核对后重试');
            result[index]=row;
          }
        }else{
          // Compatibility with adapters that provide only single-row writes.
          for(let index=0;index<result.length;index++)if(!result[index]._id)result[index]=await append(WF.events,result[index]);
        }
      }
      return {count:result.length,events:result};
    }),
    ownRegistration: async(code,account)=>one(await workflowRows(base,WF.registrations),r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名'),
    reject: (id,reason)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名');if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');if(row['报名状态']!=='待筛选')throw fail(409,'仅待确认报名可以拒绝');await syncPosition(await eventBy(row['活动ID']),row,'可报名');await update(WF.registrations,row,{报名状态:'未入选',是否报名成功:'false',处理说明:required(reason,'未入选原因')});}),
    requestLeave: (code,account,reason)=>write(async()=>{const data=await read(),row=one(data.registrations,r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名');
      if(!['待筛选','已确认'].includes(row['报名状态'])||row['请假状态']==='待审批'||data.checkins.some(c=>c['报名行ID']===row._id)||data.ledger.some(l=>l['报名行ID']===row._id))throw fail(409,'当前报名不能申请请假');
      const event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');if(event['状态']!=='报名中')throw fail(409,'活动已关闭，请联系负责人');const start=workflowConfig(event).blood?.start||`${event['报名日期']}T23:59:59+08:00`;if(now()>=Date.parse(start))throw fail(409,'活动已开始或日期已过，请联系负责人处理');
      await update(WF.registrations,row,{请假状态:'待审批',请假原因:required(reason,'请假原因'),请假申请时间:at()});
    }),
    decideLeave: (id,approved,reason)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名');if(row['请假状态']!=='待审批'||!['待筛选','已确认'].includes(row['报名状态']))throw fail(409,'没有可处理的请假申请');if(approved)await syncPosition(await eventBy(row['活动ID']),row,'可报名');await update(WF.registrations,row,{请假状态:approved?'已批准':'已驳回',处理说明:required(reason,'处理说明'),...(approved?{报名状态:'已请假',是否报名成功:'false'}:{})});}),
    submitAttendance: (code,account,photoId)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名');if(row['报名状态']!=='已确认'||row['请假状态']==='待审批')throw fail(409,'只有报名成功且未申请请假的记录可以签到');const event=await eventBy(row['活动ID']);if(!workflowEventApproved(event)||event['状态']!=='报名中')throw fail(409,'活动未开放');const blood=workflowConfig(event).blood;
      const start=blood?.start||`${event['报名日期']}T00:00:00+08:00`,end=blood?.end||`${event['报名日期']}T23:59:59+08:00`;
      if(now()<Date.parse(start)||now()>Date.parse(end))throw fail(409,'尚未进入本次活动签到时段或时段已结束');
      if(!/^[a-f0-9-]{36}$/.test(photoId))throw fail(400,'签到照片无效');if(row['签到照片ID'])throw fail(409,'签到已提交，请等待核验');await update(WF.registrations,row,{签到照片ID:photoId,签到提交时间:at()});return {submitted:true};
    }),
    exportDraft: async id=>{
      const data=await read(),event=one(data.events,row=>row._id===id||row['活动ID']===id,'活动');
      const entries=data.ledger.filter(row=>row['活动ID']===event['活动ID']&&['已批准','已入账'].includes(row['状态']));
      if(!entries.length)throw fail(409,'没有已批准的时长明细');
      const keys=new Set();const rows=[];
      for(const entry of entries){if(keys.has(entry['幂等键']))throw fail(409,'重复明细，停止导出');keys.add(entry['幂等键']);const source=await evidence(entry['报名行ID']);if(!ledgerEvidenceMatches(entry,source.sourceHash,source.event))throw fail(409,'明细来源或时长已改变，停止导出');rows.push({...source.registration,'活动名称':event['活动名称'],'是否报名成功':true,'录入状态':'待录入','签到表':[source.checkin._id],'志愿时长':Number(entry['服务时长'])});}
      const checks=data.checkins.map(row=>({...row,'活动名称':[row['报名行ID']]}));
      const config={_id:event._id,活动报名总表:rows.map(row=>row._id),具体工作地点:event['地点'],正式工作日期:event['报名日期'], '实际培训时长/小时':event['培训时长'], '实际交通时长/小时':event['交通时长'],志愿者具体工作内容:event['工作内容']};
      const draft=previewHoursExport(rows,checks,rows.map(row=>row._id),config);
      draft.rows=draft.rows.map((row,index)=>{const selected=draft.grouping==='student'?entries.filter(e=>e['学号']===row['学号']):[entries[index]];return {...row,培训时长:selected.reduce((sum,e)=>sum+Number(e['培训时长']),0),交通时长:selected.reduce((sum,e)=>sum+Number(e['交通时长']),0)};});
      return {...draft,source:WF.registrations};
    },
    mode,
    create: (body,actor)=>write(()=>{if(bloodSourceTable&&body.templateId==='blood_vehicle')throw fail(409,'献血车班次由 NJUTable 自动生成');if(body.blood||body.source)throw fail(400,'献血车申请请使用排班模板入口');return createEvent(body,actor);}),
    stop: (id,reason)=>write(async()=>{const event=await eventBy(id);if(!workflowConfig(event).blood||event['状态']!=='报名中')throw fail(409,'只有已开放的献血车班次可以停点');await update(WF.events,event,{状态:'停点',停点说明:required(reason,'停点原因')});}),
    approve: (id,actor,role)=>write(async()=>{const row=await eventBy(id);if(row['状态']!=='待审核')throw fail(409,'只有待审核申请可以批准');assertPrepared(row);if(row['负责人账号ID']===actor&&role!=='super_admin')throw fail(403,'负责人不能审批自己的申请');await update(WF.events,row,{批准版本:row['申请版本'],批准摘要:workflowApprovalHash(row),审批人:actor,审批时间:at(),状态:'可发布'});}),
    publish: id=>write(async()=>{const row=await eventBy(id);if(row['状态']!=='可发布'||!workflowEventApproved(row)||row['准备状态']!=='已准备')throw fail(409,'申请未获批或准备未完成');assertPrepared(row);await update(WF.events,row,{状态:'报名中'});}),
    register: (id,account,options={})=>write(async()=>{const row=await eventBy(id);if(row.sourceSuperseded||row['状态']!=='报名中'||!workflowEventApproved(row))throw fail(409,'活动未开放报名');
      const accountId=required(account.accountId,'账号ID'),sid=required(account.studentId,'学号'),name=required(account.realName,'真实姓名'),email=required(account.email,'邮箱');if(!account.emailVerified||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(email)||email.split('@')[0]!==sid)throw fail(403,'需已验证且学号一致的校园邮箱');
      const regs=await workflowRows(base,WF.registrations);const config=workflowConfig(row),blood=config.blood,activityIds=[row['活动ID'],...(config.sourceActivityIds||[])];
      const existing=regs.find(r=>activityIds.includes(r['活动ID'])&&r['账号ID']===accountId&&r['学号']===sid);if(existing&&mode==='production'&&config.source?.kind==='generated_blood'&&existing['报名状态']==='待筛选'){await syncPosition(row,existing);return existing;}
      if(Number(config.sourceOccupied||0)+regs.filter(r=>activityIds.includes(r['活动ID'])&&['待筛选','已确认','已签到'].includes(r['报名状态'])).length>=Number(row['容量']))throw fail(409,'本班次名额已满，请选择其他时段');
      if(blood){if(now()>=Date.parse(blood.start))throw fail(409,'此班次已开始，不能报名');
        const events=await eventRows();if(regs.some(r=>['待筛选','已确认','已签到'].includes(r['报名状态'])&&(r['账号ID']===accountId||r['学号']===sid)&&events.some(e=>{const b=workflowConfig(e).blood;return e['活动ID']===r['活动ID']&&b&&Date.parse(b.start)<Date.parse(blood.end)&&Date.parse(b.end)>Date.parse(blood.start);})))throw fail(409,'已有重叠班次的报名，请先处理原报名');
      }if(regs.some(r=>activityIds.includes(r['活动ID'])&&(r['账号ID']===accountId||r['学号']===sid)))throw fail(409,'已报名此活动');
      const registration=await append(WF.registrations,{活动名称:row['活动名称'],活动类别:row['活动类别'],报名ID:`WR-${randomUUID()}`,活动ID:row['活动ID'],账号ID:accountId,学号:sid,姓名:name,邮箱:email,院系:str(account.department),报名日期:row['报名日期'],报名时段:row['报名时段'],岗位:row['岗位'],校区:str(options.campus||account.campus),报名类型:'普通',报名状态:'待筛选',是否报名成功:'false',志愿时长:'',录入状态:'网站待核对',岗位同步状态:config.source?.kind==='generated_blood'&&mode==='production'?'待同步':'',创建时间:at()});
      await syncPosition(row,registration);return registration;
    }),
    confirm: id=>write(async()=>{const data=await read();const row=one(data.registrations,r=>r._id===id,'报名');const event=one(data.events,r=>r['活动ID']===row['活动ID'],'活动');if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');if(row['报名状态']==='已确认'&&event['状态']==='报名中'&&workflowEventApproved(event))return row;if(row['报名状态']!=='待筛选')throw fail(409,'报名不在待筛选状态');if(event['状态']!=='报名中'||!workflowEventApproved(event))throw fail(409,'活动审批或报名状态已改变');if(data.registrations.filter(r=>[row['活动ID'],...(workflowConfig(event).sourceActivityIds||[])].includes(r['活动ID'])&&['已确认','已签到'].includes(r['报名状态'])).length+Number(workflowConfig(event).sourceOccupied||0)>=number(event['容量'],'容量',{positive:true}))throw fail(409,'活动容量已满');await syncPosition(event,row,'成功');await update(WF.registrations,row,{报名状态:'已确认',是否报名成功:'true'});}),
    checkin: (id,actor,note)=>write(()=>verifyAttendance(id,actor,note)),
    reviewHours: (id,actor,overrides={})=>write(()=>makeHours(id,actor,overrides)),
    checkinAndReview: (id,actor,body)=>write(async()=>{
      for(const [key,label] of [['serviceHours','服务时长'],['trainingHours','培训时长'],['travelHours','交通时长']])if(body[key]!==undefined)number(body[key],label,{positive:key==='serviceHours'});
      const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名');
      if(row['报名状态']!=='已签到')await verifyAttendance(id,actor,body.note);
      return makeHours(id,actor,Object.fromEntries(['serviceHours','trainingHours','travelHours'].filter(key=>body[key]!==undefined).map(key=>[key,body[key]])));
    }),
    approveHours: (id,actor,role)=>write(async()=>{const row=one(await workflowRows(base,WF.ledger),r=>r._id===id,'时长明细');if(row['状态']!=='待批准')throw fail(409,'时长不在待批准状态');if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'核对人不能批准自己的时长核对');const source=await evidence(row['报名行ID']);if(!ledgerEvidenceMatches(row,source.sourceHash,source.event))throw fail(409,'源记录或候选时长改变，需重新核验');await update(WF.ledger,row,{状态:'已批准',批准人:actor,批准时间:at()});}),
    post: id=>write(async()=>{const row=one(await workflowRows(base,WF.ledger),r=>r._id===id,'时长明细');if(!['已批准','已入账'].includes(row['状态']))throw fail(409,'时长尚未批准');const source=await evidence(row['报名行ID']);if(!ledgerEvidenceMatches(row,source.sourceHash,source.event))throw fail(409,'源记录改变，停止入账并对账');return mirror(row['账号ID']);}),
  };
}
