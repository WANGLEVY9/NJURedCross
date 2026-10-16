import {createHash} from 'node:crypto';
import {activityWindow,positionWithinActivity} from '../../public/app/shared/activity-window.js';
import {workflowConfig} from './blood-roster.js';
import {ORDINARY_GROUP_TABLE} from './ordinary-groups.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Called inside the workflow write lock. Persist the plan before generating rows,
 * so an interrupted request can resume without creating duplicate positions. */
export function projectPositions({eventBy,rows,append,update,prepare,approved,approvalHash,eventsTable,registrationsTable}){
 return {
  async configure(id,body,actor){
   let parent=await eventBy(id),c=workflowConfig(parent);
   const wasApproved=approved(parent);
   if(c.bookingMode!=='grouped'||!['草稿','待审核','可发布','报名中'].includes(parent['状态'])||['可发布','报名中'].includes(parent['状态'])&&!wasApproved)throw fail(409,'当前活动不能配置岗位');
   if(!body||Object.keys(body).some(k=>!['token','positions','deadline'].includes(k))||!Array.isArray(body.positions)||!body.positions.length||body.positions.length>200)throw fail(400,'请填写1至200个岗位');
   const deadline=activityWindow(body.deadline,c.window?.start);
   if(!deadline)throw fail(400,'报名截止须早于活动开始');
   const positions=body.positions.map(p=>{
    if(!p||Object.keys(p).some(k=>!['start','end','location','name','capacity','campus'].includes(k))||!positionWithinActivity(p,c.window))throw fail(400,'岗位时间须在活动范围内');
    const window=activityWindow(p.start,p.end),capacity=Number(p.capacity);
    if(!Number.isSafeInteger(capacity)||capacity<1||typeof p.name!=='string'||!p.name.trim()||p.name.length>500||typeof p.location!=='string'||!p.location.trim()||p.location.length>500||!['鼓楼','仙林','浦口','苏州'].includes(p.campus))throw fail(400,'请完整填写岗位名称、地点、校区与人数');
    return {...window,name:p.name.trim(),location:p.location.trim(),capacity,campus:p.campus};
   });
   if(positions.reduce((n,p)=>n+p.capacity,0)>Number(parent['容量']))throw fail(400,'岗位总名额不能超过活动名额');
   const keys=positions.map(p=>[p.start,p.end,p.location,p.name].join('|'));
   if(new Set(keys).size!==keys.length)throw fail(400,'请勿重复设置同一岗位');
   const inputHash=hash({positions,deadline:deadline.start});
   const retry=c.positionPlan?.inputHash===inputHash&&c.positionPlan.token===body.token;
   if(body.token!==approvalHash(parent)&&!retry)throw fail(409,'活动已变化，请刷新后配置');
   if(!wasApproved){
    c.positionDraft={positions,deadline:deadline.start,inputHash,actor};
    await update(eventsTable,parent,{报名页配置:JSON.stringify(c)});
    return {events:[],draft:true};
   }
   if(c.positionPlan?.complete===false&&c.positionPlan.inputHash!==inputHash)throw fail(409,'上次岗位保存未完成，请先重试原安排');
   const existing=await rows(eventsTable),children=existing.filter(e=>workflowConfig(e).parentActivityId===parent['活动ID']);
   if(c.positionPlan?.complete===true&&c.positionPlan.inputHash===inputHash)return {events:children.filter(e=>c.positionPlan.eventIds.includes(e['活动ID'])),groupId:c.positionPlan.groupId,unchanged:true};
   const definition=e=>{const o=workflowConfig(e).ordinary;return o?{...activityWindow(o.start,o.end),name:e['岗位'],location:e['地点'],capacity:Number(e['容量']),campus:o.campus}:null;};
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
   c.positionPlan={inputHash,positions,deadline:deadline.start,token:retry?c.positionPlan.token:body.token,groupId,actor,eventIds,complete:false};delete c.positionDraft;
   const patch={报名页配置:JSON.stringify(c),状态:'可发布'};patch['批准摘要']=approvalHash({...parent,...patch});
   await update(eventsTable,parent,patch);parent={...parent,...patch};
   const plan=c.positionPlan;
   if(!matches.length)await append(ORDINARY_GROUP_TABLE,{活动组ID:plan.groupId,活动名称:parent['活动名称'],组织类别:parent['组织类别'],活动地区:parent['活动地区'],负责人账号ID:parent['负责人账号ID'],班次数:positions.length,报名截止:plan.deadline,报名开关:'关闭',状态:'草稿',修改人:actor,更新时间:new Date().toISOString()});
   else await update(ORDINARY_GROUP_TABLE,matches[0],{班次数:positions.length,报名截止:plan.deadline,修改人:actor,更新时间:new Date().toISOString()});
   for(const child of removed)await update(eventsTable,child,{状态:'已结束'});
   const result=[];
   for(const [index,p] of positions.entries()){
    const activityId=eventIds[index];
    const child=prepare({name:parent['活动名称'],category:parent['活动类别'],center:c.center,region:c.region,date:p.start.slice(0,10),slot:`${p.start.slice(11,19)}-${p.end.slice(11,19)}`,position:p.name,location:p.location,capacity:p.capacity,work:c.work,content:c.content,serviceHours:c.service,trainingHours:c.training,travelHours:c.travel,coOwners:c.coOwners,ordinary:{groupId:plan.groupId,start:p.start,end:p.end,campus:p.campus,hoursPending:false}});
    const childConfig=workflowConfig(child);childConfig.parentActivityId=parent['活动ID'];childConfig.parentPlan=inputHash;childConfig.approval=c.approval;
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
   return {events:result,groupId:plan.groupId};
  },
  async publish(id){
   let parent=await eventBy(id),c=workflowConfig(parent);
   if(c.positionDraft&&approved(parent)&&parent['状态']==='可发布'){
    await this.configure(id,{positions:c.positionDraft.positions.map(({seconds,...p})=>p),deadline:c.positionDraft.deadline,token:approvalHash(parent)},c.positionDraft.actor);
    parent=await eventBy(id);c=workflowConfig(parent);
   }
   const plan=c.positionPlan;
   if(c.bookingMode!=='grouped'||!['可发布','报名中'].includes(parent['状态'])||!approved(parent)||!plan)throw fail(409,'请先完成审批和岗位配置');
   const children=(await rows(eventsTable)).filter(e=>workflowConfig(e).parentActivityId===parent['活动ID']&&(!plan.eventIds||plan.eventIds.includes(e['活动ID'])));
   if(plan.complete===false)throw fail(409,'岗位保存未完成，请重试保存');
   if(children.length!==plan.positions.length||children.some(e=>!approved(e)||workflowConfig(e).parentPlan!==plan.inputHash||!['可发布','报名中'].includes(e['状态'])))throw fail(409,'岗位未完整生成或已发生变化，不能发布');
   const matches=(await rows(ORDINARY_GROUP_TABLE)).filter(g=>g['活动组ID']===plan.groupId);if(matches.length!==1)throw fail(409,'活动项目记录不完整');
   if(!Number.isFinite(Date.parse(matches[0]['报名截止']))||Date.parse(matches[0]['报名截止'])<=Date.now())throw fail(409,'报名截止已过，请在项目报名设置中调整');
   if(parent['状态']==='报名中'&&matches[0]['状态']==='已发布')return {count:children.length};
   // Closed group is the publication barrier; partial writes remain unbookable.
   for(const child of children)if(child['状态']!=='报名中')await update(eventsTable,child,{状态:'报名中'});
   await update(eventsTable,parent,{状态:'报名中'});
   await update(ORDINARY_GROUP_TABLE,matches[0],{状态:'已发布',报名开关:'开放',修改人:plan.actor,更新时间:new Date().toISOString()});
   return {count:children.length};
  },
 };
}
