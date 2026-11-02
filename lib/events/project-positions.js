import {createHash} from 'node:crypto';
import {activityWindow,positionWithinActivity} from '../../public/app/shared/activity-window.js';
import {workflowConfig} from './blood-roster.js';
import {ORDINARY_GROUP_TABLE} from './ordinary-groups.js';
import {noticeTemplate,syncNoticeSchedule} from '../../public/app/shared/activity-management.js';
import {flexibleCapacity} from '../../public/app/shared/activity-capacity.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_CAPACITY=100000;
const hourFields=['serviceHours','trainingHours','travelHours'];
function positionHours(position){
 const result={};
 for(const key of hourFields){
  if(position[key]===undefined)continue;
  const value=position[key];
  if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100000||key==='serviceHours'&&Number(value)===0)throw fail(400,'岗位时长无效');
  result[key]=Number(value);
 }
 return result;
}
export function expandProjectCapacity(event,c,total,registrationTotal=total){
 const old=workflowConfig(event),previousCapacity=Number(event['容量']);
 const previousRegistrationLimit=Math.max(previousCapacity,Number(old.registrationLimit??previousCapacity));
 const capacity=Math.max(previousCapacity,Number(c.capacity),total),registrationLimit=Math.max(previousRegistrationLimit,Number(c.registrationLimit??capacity),capacity,registrationTotal);
 if(![total,capacity,registrationLimit].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=MAX_CAPACITY))throw fail(400,'岗位总名额不能超过100000，活动容量与报名上限须在有效范围内');
 const source=String(event['通知草稿']||'');
 const customized=Boolean(old.noticeCustomized)||Boolean(source&&syncNoticeSchedule(source,old.publishAt)!==noticeTemplate(old));
 c.capacity=capacity;c.registrationLimit=registrationLimit;
 if(customized)c.noticeCustomized=true;
 const notice=customized?source:noticeTemplate(c),capacityAdjusted=capacity>previousCapacity,registrationLimitAdjusted=registrationLimit>previousRegistrationLimit;
 return {notice,capacityChange:{previousCapacity,capacity,capacityAdjusted,previousRegistrationLimit,registrationLimit,registrationLimitAdjusted,noticeUpdated:notice!==source,noticeReviewRequired:customized&&(capacityAdjusted||registrationLimitAdjusted)}};
}
export function normalizePositions(positions,window){
 if(!Array.isArray(positions)||!positions.length||positions.length>200)throw fail(400,'请填写1至200个岗位');
 const normalized=positions.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['start','end','seconds','location','name','capacity','flexibleCapacity','campus','work','content',...hourFields].includes(k))||!positionWithinActivity(p,window))throw fail(400,'岗位时间须在活动范围内');
  const capacity=Number(p.capacity);
  if(!['number','string'].includes(typeof p.capacity)||!Number.isSafeInteger(capacity)||capacity<1||capacity>MAX_CAPACITY||typeof p.name!=='string'||!p.name.trim()||p.name.length>500||typeof p.location!=='string'||!p.location.trim()||p.location.length>500||p.campus&&!['鼓楼','仙林','浦口','苏州'].includes(p.campus))throw fail(400,'请完整填写岗位名称、地点与人数');
  for(const key of ['work','content'])if(p[key]!==undefined&&(typeof p[key]!=='string'||p[key].length>500))throw fail(400,'岗位工作内容不能超过500字');
  if(p.work?.trim()&&p.content?.trim()&&p.work.trim()!==p.content.trim())throw fail(400,'岗位工作内容不一致');
  const work=p.work?.trim()||p.content?.trim();
  return {...activityWindow(p.start,p.end),name:p.name.trim(),location:p.location.trim(),capacity,...(p.flexibleCapacity!==undefined?{flexibleCapacity:flexibleCapacity(p.flexibleCapacity)}:{}),campus:p.campus||'',...(work?{work}:{}),...positionHours(p)};
 });
 if(normalized.reduce((n,p)=>n+p.capacity+flexibleCapacity(p.flexibleCapacity),0)>MAX_CAPACITY)throw fail(400,'岗位含弹性名额的报名上限不能超过100000');
 const keys=normalized.map(p=>[p.start,p.end,p.location,p.name].join('|'));
 if(new Set(keys).size!==keys.length)throw fail(400,'请勿重复设置同一岗位');
 return normalized;
}
/** Read-only gate for every grouped publication/scheduling entry point. Does not
 * replace publish(), which verifies approval, child rows and the closed barrier. */
export function assertProjectPositions(event){
 const c=workflowConfig(event);
 if(c.bookingMode!=='grouped')return;
 // Match publish(): an approved, ready parent materializes its draft first.
 const plan=event['状态']==='可发布'&&c.positionDraft?c.positionDraft:c.positionPlan||c.positionDraft;
 try{normalizePositions(plan?.positions,c.window);if(!activityWindow(plan?.deadline,c.window?.start))throw Error('deadline');}
 catch{throw fail(409,'分岗位活动至少需要一个有效岗位及报名截止时间');}
 return plan;
}
/** Called inside the workflow write lock. Persist the plan before generating rows,
 * so an interrupted request can resume without creating duplicate positions. */
export function projectPositions({eventBy,rows,append,update,prepare,approved,approvalHash,eventsTable,registrationsTable,now=()=>Date.now()}){
 return {
  async configure(id,body,actor){
   let parent=await eventBy(id),c=workflowConfig(parent);
   const wasApproved=approved(parent);
   if(c.bookingMode!=='grouped'||!['草稿','待审核','可发布','报名中'].includes(parent['状态'])||['可发布','报名中'].includes(parent['状态'])&&!wasApproved)throw fail(409,'当前活动不能配置岗位');
   if(!body||Object.keys(body).some(k=>!['token','positions','deadline'].includes(k))||!Array.isArray(body.positions)||!body.positions.length||body.positions.length>200)throw fail(400,'请填写1至200个岗位');
   const deadline=activityWindow(body.deadline,c.window?.start);
   if(!deadline)throw fail(400,'报名截止须早于活动开始');
   const positions=normalizePositions(body.positions,c.window);
   const inputHash=hash({positions,deadline:deadline.start});
   const saved=wasApproved?c.positionPlan:c.positionDraft;
   const retry=saved?.inputHash===inputHash&&saved.token===body.token;
   if(body.token!==approvalHash(parent)&&!retry)throw fail(409,'活动已变化，请刷新后配置');
   const {capacityChange,notice}=expandProjectCapacity(parent,c,positions.reduce((n,p)=>n+p.capacity,0),positions.reduce((n,p)=>n+p.capacity+flexibleCapacity(p.flexibleCapacity),0)),capacity=c.capacity;
   if(!wasApproved){
    c.positionDraft={positions,deadline:deadline.start,inputHash,actor,token:body.token,capacityChange:retry?saved.capacityChange:capacityChange};
    await update(eventsTable,parent,{容量:String(capacity),通知草稿:notice,报名页配置:JSON.stringify(c)});
    return {events:[],draft:true,...c.positionDraft.capacityChange};
   }
   if(c.positionPlan?.complete===false&&c.positionPlan.inputHash!==inputHash)throw fail(409,'上次岗位保存未完成，请先重试原安排');
   const existing=await rows(eventsTable),children=existing.filter(e=>workflowConfig(e).parentActivityId===parent['活动ID']);
   if(c.positionPlan?.complete===true&&c.positionPlan.inputHash===inputHash)return {events:children.filter(e=>c.positionPlan.eventIds.includes(e['活动ID'])),groupId:c.positionPlan.groupId,unchanged:true,...c.positionPlan.capacityChange};
   const definition=e=>{const config=workflowConfig(e),o=config.ordinary;return o?{...activityWindow(o.start,o.end),name:e['岗位'],location:e['地点'],capacity:Number(e['容量']),...(config.flexibleCapacity!==undefined?{flexibleCapacity:config.flexibleCapacity}:{}),campus:o.campus,...(config.positionWork?{work:config.positionWork}:{}),...positionHours(config.positionHours||{})}:null;};
   const eventIds=positions.map(p=>{
    const found=children.filter(e=>hash(definition(e))===hash(p));
    if(found.length>1)throw fail(409,'岗位记录重复，请核对');
    return found[0]?.['活动ID']||`PS-${hash([parent['活动ID'],p]).slice(0,32)}`;
   });
   const removed=children.filter(e=>!eventIds.includes(e['活动ID'])&&e['状态']!=='已结束');
   const restored=children.filter(e=>eventIds.includes(e['活动ID'])&&e['状态']==='已结束');
   if([...removed,...restored].length){const registrations=await rows(registrationsTable);if(registrations.some(r=>[...removed,...restored].some(e=>e['活动ID']===r['活动ID'])))throw fail(409,'已有报名记录的岗位不能移除、改写或重新开启；可保留该岗位并新增其他岗位');}
   if(children.some(e=>eventIds.includes(e['活动ID'])&&!approved(e)))throw fail(409,'已有岗位批准信息不一致，请核对');
   const groups=await rows(ORDINARY_GROUP_TABLE),groupId=c.positionPlan?.groupId||`PROJECT-${parent['活动ID']}`,matches=groups.filter(g=>g['活动组ID']===groupId);
   if(matches.length>1)throw fail(409,'项目记录重复，请核对底表');
   // Close the publication barrier before persisting a new plan or child rows.
   if(matches.length)await update(ORDINARY_GROUP_TABLE,matches[0],{报名开关:'关闭',状态:'草稿'});
   c.positionPlan={inputHash,positions,deadline:deadline.start,token:retry?c.positionPlan.token:body.token,groupId,actor,eventIds,complete:false,capacityChange:retry?saved.capacityChange:capacityChange};delete c.positionDraft;
   const patch={容量:String(capacity),通知草稿:notice,报名页配置:JSON.stringify(c),状态:'可发布'};patch['批准摘要']=approvalHash({...parent,...patch});
   await update(eventsTable,parent,patch);parent={...parent,...patch};
   const plan=c.positionPlan;
   if(!matches.length)await append(ORDINARY_GROUP_TABLE,{活动组ID:plan.groupId,活动名称:parent['活动名称'],组织类别:parent['组织类别'],活动地区:parent['活动地区'],负责人账号ID:parent['负责人账号ID'],班次数:positions.length,报名截止:plan.deadline,报名开关:'关闭',状态:'草稿',修改人:actor,更新时间:new Date().toISOString()});
   else await update(ORDINARY_GROUP_TABLE,matches[0],{班次数:positions.length,报名截止:plan.deadline,修改人:actor,更新时间:new Date().toISOString()});
   for(const child of removed)await update(eventsTable,child,{状态:'已结束'});
   const result=[];
   for(const [index,p] of positions.entries()){
    const activityId=eventIds[index];
    const child=prepare({name:parent['活动名称'],category:parent['活动类别'],center:c.center,region:c.region,date:p.start.slice(0,10),slot:`${p.start.slice(11,19)}-${p.end.slice(11,19)}`,position:p.name,location:p.location,capacity:p.capacity,...(p.flexibleCapacity!==undefined?{flexibleCapacity:p.flexibleCapacity}:{}),work:p.work||c.work,content:p.work||c.content,serviceHours:p.serviceHours??c.service,trainingHours:p.trainingHours??c.training,travelHours:p.travelHours??c.travel,coOwners:c.coOwners,ordinary:{groupId:plan.groupId,start:p.start,end:p.end,campus:p.campus,hoursPending:false}});
    const childConfig=workflowConfig(child);childConfig.parentActivityId=parent['活动ID'];childConfig.parentPlan=inputHash;childConfig.approval=c.approval;if(c.registrationContact)childConfig.registrationContact=c.registrationContact;
    if(p.work)childConfig.positionWork=p.work;
    const hours=positionHours(p);if(Object.keys(hours).length)childConfig.positionHours=hours;
    Object.assign(child,{活动ID:activityId,负责人账号ID:parent['负责人账号ID'],申请版本:parent['申请版本'],批准版本:parent['批准版本'],审批人:parent['审批人'],审批时间:parent['审批时间'],报名页配置:JSON.stringify(childConfig),状态:'可发布'});
    for(const key of Object.keys(child))child[key]=String(child[key]??'');
    child['批准摘要']=approvalHash(child);
    const found=existing.filter(e=>e['活动ID']===activityId);
    if(found.length>1)throw fail(409,'已生成岗位重复，请核对');
    if(found.length){
     if(!approved(found[0]))throw fail(409,'已有岗位批准信息不一致，请核对');
     // Keep roster/mail state and stable registration IDs on unchanged positions.
     const next={...workflowConfig(found[0]),parentPlan:inputHash};
     const delta={报名页配置:JSON.stringify(next),状态:'可发布'};delta['批准摘要']=approvalHash({...found[0],...delta});
     await update(eventsTable,found[0],delta);result.push({...found[0],...delta});
    }else result.push(await append(eventsTable,{...child,创建时间:new Date().toISOString()}));
   }
   plan.complete=true;const final={报名页配置:JSON.stringify(c)};final['批准摘要']=approvalHash({...parent,...final});await update(eventsTable,parent,final);
   return {events:result,groupId:plan.groupId,...plan.capacityChange};
  },
  async publish(id,{publishAt}={}){
   let parent=await eventBy(id),c=workflowConfig(parent);
   assertProjectPositions(parent);
   if(c.positionDraft&&approved(parent)&&parent['状态']==='可发布'){
    await this.configure(id,{positions:c.positionDraft.positions.map(({seconds,...p})=>p),deadline:c.positionDraft.deadline,token:approvalHash(parent)},c.positionDraft.actor);
    parent=await eventBy(id);c=workflowConfig(parent);
   }
   const plan=c.positionPlan;
   if(c.bookingMode!=='grouped'||!['可发布','报名中'].includes(parent['状态'])||!approved(parent)||!plan)throw fail(409,'请先完成审批和岗位配置');
   if(!Array.isArray(plan.eventIds)||plan.eventIds.length!==plan.positions.length||new Set(plan.eventIds).size!==plan.eventIds.length)throw fail(409,'岗位记录不完整，不能发布');
   const children=(await rows(eventsTable)).filter(e=>workflowConfig(e).parentActivityId===parent['活动ID']&&(!plan.eventIds||plan.eventIds.includes(e['活动ID'])));
   if(plan.complete===false)throw fail(409,'岗位保存未完成，请重试保存');
   if(children.length!==plan.positions.length||new Set(children.map(e=>e['活动ID'])).size!==plan.positions.length||children.some(e=>!approved(e)||workflowConfig(e).parentPlan!==plan.inputHash||!['可发布','报名中'].includes(e['状态'])))throw fail(409,'岗位未完整生成或已发生变化，不能发布');
   const matches=(await rows(ORDINARY_GROUP_TABLE)).filter(g=>g['活动组ID']===plan.groupId);if(matches.length!==1)throw fail(409,'活动项目记录不完整');
   if(!Number.isFinite(Date.parse(matches[0]['报名截止']))||Date.parse(matches[0]['报名截止'])<=now())throw fail(409,'报名截止已过，请在项目报名设置中调整');
   const target=publishAt===undefined?c.publishAt:publishAt;
   if(target!=null&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(target)||!activityWindow(target,c.window.start)||Date.parse(target)>=Date.parse(matches[0]['报名截止'])))throw fail(400,'定时发布须早于活动开始及报名截止');
   if(publishAt!=null&&Date.parse(publishAt)<=now())throw fail(400,'定时发布时间须在未来');
   if(parent['状态']==='报名中'&&matches[0]['状态']==='已发布'&&matches[0]['报名开关']==='开放'&&[parent,...children].every(e=>(workflowConfig(e).publishAt||null)===(target||null)))return {count:children.length,publishAt:target||null};
   // Closed group is the publication barrier; partial writes remain unbookable.
   await update(ORDINARY_GROUP_TABLE,matches[0],{状态:'草稿',报名开关:'关闭'});
   for(const event of [...children,parent]){
    const config=workflowConfig(event);if(target==null)delete config.publishAt;else config.publishAt=target;
    if(config.publicationNotice&&!config.publicationNotice.publishedAt)config.publicationNotice.publishedAt=new Date(now()).toISOString();
    const patch={状态:'报名中',报名页配置:JSON.stringify(config),通知草稿:syncNoticeSchedule(event['通知草稿'],target)};patch['批准摘要']=approvalHash({...event,...patch});
    await update(eventsTable,event,patch);
   }
   await update(ORDINARY_GROUP_TABLE,matches[0],{状态:'已发布',报名开关:'开放',修改人:plan.actor,更新时间:new Date().toISOString()});
   return {count:children.length,publishAt:target||null};
  },
  async cancelSchedule(id){
   const parent=await eventBy(id),c=workflowConfig(parent),plan=c.positionPlan;
   assertProjectPositions(parent);
   if(c.bookingMode!=='grouped'||!approved(parent)||!['报名中','可发布'].includes(parent['状态'])||!(Date.parse(c.publishAt)>now())||!plan||plan.complete===false)throw fail(409,'当前活动没有可撤销的未来定时发布');
   const children=(await rows(eventsTable)).filter(e=>workflowConfig(e).parentActivityId===parent['活动ID']&&plan.eventIds?.includes(e['活动ID']));
   if(!Array.isArray(plan.eventIds)||plan.eventIds.length!==plan.positions.length||new Set(plan.eventIds).size!==plan.positions.length||children.length!==plan.positions.length||new Set(children.map(e=>e['活动ID'])).size!==plan.positions.length||children.some(e=>!approved(e)||workflowConfig(e).parentPlan!==plan.inputHash||!['可发布','报名中'].includes(e['状态'])))throw fail(409,'岗位记录不完整，不能撤销定时发布');
   const groups=(await rows(ORDINARY_GROUP_TABLE)).filter(g=>g['活动组ID']===plan.groupId);
   if(groups.length!==1)throw fail(409,'活动项目记录不完整');
   await update(ORDINARY_GROUP_TABLE,groups[0],{状态:'草稿',报名开关:'关闭'});
   // Parent last retains the retry marker if any child update is interrupted.
   for(const event of [...children,parent]){
    const config=workflowConfig(event);delete config.publishAt;
    const patch={状态:'可发布',报名页配置:JSON.stringify(config),通知草稿:syncNoticeSchedule(event['通知草稿'],'')};patch['批准摘要']=approvalHash({...event,...patch});
    await update(eventsTable,event,patch);
   }
   return {count:children.length,publishAt:null};
  },
 };
}
