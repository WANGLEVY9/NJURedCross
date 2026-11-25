import {createHash} from 'node:crypto';
import {isAccountActive} from '../permissions.js';
import {isValidDeliveryEmail} from '../identity/mail-recipient.js';
import {assertRequestActive} from '../http/request-budget.js';
import {activityKind,activityRegion} from '../../public/app/shared/activity-taxonomy.js';
import {activityProjectKey,activityProjects} from '../../public/app/shared/activity-projects.js';
import {ACTIVITY_FEEDBACK_TEMPLATES,validFeedbackTemplate} from '../../public/app/shared/activity-feedback.js';
import {workflowConfig} from './blood-roster.js';
import {workspaceRosterEvidence} from './workspace-roster.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const regions=['nanjing','suzhou'];
function feedbackRoster(roster){
  // The provider adds synthetic global entries for platform administrators. Feedback
  // uses only roles explicitly held as department management or presidium members.
  return (roster.assignedRows||roster.rows).flatMap(row=>{
    if(row.role!=='global')return [row];
    if(row.finalCategories?.length)return [{...row,role:'presidium',categories:row.finalCategories}];
    if(row.initialCategories?.length)return [{...row,role:'director',categories:row.initialCategories}];
    return [];
  });
}
const actorRoles=(roster,actor)=>{
 const rows=feedbackRoster(roster);
 return regions.map(region=>workspaceRosterEvidence(actor,region,rows,{complete:roster.complete})).filter(role=>role.verified);
};
const canView=(roles,event)=>roles.some(role=>role.role==='presidium'||role.region===event.region&&role.categories.includes(event.center));

function eventDirectory(events){
 const names=new Map(activityProjects(events).map(project=>[activityProjectKey(project),project.projectName]));
 const directory=new Map(),duplicates=new Set();
 for(const row of events){
  const id=row['活动ID'],config=workflowConfig(row),project=activityProjectKey(row);
  if(!id||directory.has(id)){duplicates.add(id);continue;}
  const center=activityKind({center:row['组织类别']||config.center})||'未分类';
  const region=activityRegion({region:row['活动地区']||config.region})==='suzhou'?'suzhou':'nanjing';
  directory.set(id,{id,center,region,department:`${region==='suzhou'?'苏州':'南京'} · ${center}`,
   project,projectName:names.get(project)||row['活动名称'],title:row['活动名称'],date:row['报名日期']||''});
 }
 for(const id of duplicates)directory.delete(id);
 return directory;
}

const csvCell=value=>{
 let str=String(value??'');
 if(/^[\s\p{C}]*[=+\-@]/u.test(str)||/^[\t\r\n]/.test(str))str="'"+str;
 return '"'+str.replaceAll('"','""')+'"';
};

export function createActivityFeedbackManagement({getStore,getRoster,getEvents}){
 async function scope(account){
  if(!isAccountActive(account)||account.emailVerified!==true)throw fail(403,'没有活动反馈管理权限');
  const roster=await getRoster();
  const roles=actorRoles(roster,account.accountId);
  if(!roles.length)throw fail(403,'没有活动反馈管理权限');
  return roles;
 }
 async function context(account){
  const roles=await scope(account);
  const store=await getStore(),used=new Set(await store.eventIds());
  const directory=used.size?eventDirectory(await getEvents()):new Map();
  return {store,events:[...directory.values()].filter(event=>used.has(event.id)&&canView(roles,event))};
 }
 return {
  async tasks(account){
   const {store,events}=await context(account),byId=new Map(events.map(event=>[event.id,event]));
   return (await store.unread(account.accountId,[...byId.keys()])).map(row=>({type:'活动反馈待阅',priority:'medium',
    title:byId.get(row['活动ID']).title,detail:'有新的活动反馈',view:'activity-feedback',target:{id:row['报名行ID']}}));
  },
  async list(account,params,{exporting=false}={}){
   const {store,events}=await context(account);
   const department=params.get('department'),project=params.get('project'),eventId=params.get('event');
   const id=params.get('feedback')||'',template=params.get('template')||'';
   if(template&&!validFeedbackTemplate(template))throw fail(400,'活动反馈模板无效');
   const page=Number(params.get('page')||1);
   if(!Number.isSafeInteger(page)||page<1||page>10000)throw fail(400,'页码无效');
   const matches=events.filter(event=>(!department||event.department===department)&&(!project||event.project===project)&&(!eventId||event.id===eventId));
   const limit=exporting?1000:25,byId=new Map(matches.map(event=>[event.id,event]));
   const rows=await store.list({actor:account.accountId,ids:[...byId.keys()],template,id,limit:limit+1,offset:exporting?0:(page-1)*limit});
   const items=rows.slice(0,limit).map(row=>({...row,event:byId.get(row.eventId)}));
   if(!exporting)return {items,events,page,hasNext:rows.length>limit};
   if(rows.length>limit)throw fail(413,'请缩小筛选范围后导出');
   const table=[['部门','项目','活动','姓名','模板','评分','反馈全文','提交时间','修改时间'],...items.map(row=>{
    const definition=ACTIVITY_FEEDBACK_TEMPLATES[row.template];
    return [row.event.department,row.event.projectName,row.event.title,row.name,definition.label,row.rating,
     row.answers.map((text,index)=>`${definition.questions[index]}：${text}`).join('\n'),row.submittedAt,row.updatedAt];
   })];
   return '\uFEFF'+table.map(row=>row.map(csvCell).join(',')).join('\r\n');
  },
  async markRead(account,id){
   const {store,events}=await context(account);
   const [row]=await store.list({actor:account.accountId,ids:events.map(event=>event.id),id,limit:1});
   if(!row)throw fail(404,'找不到可查看的活动反馈');
   await store.markRead(id,account.accountId);
  },
  async deliver({send,origin}){
   const store=await getStore(),pending=await store.pending();
   if(!pending.length)return;
   const [roster,events]=await Promise.all([getRoster(),getEvents()]);
   if(!roster.complete)throw fail(503,'活动反馈通知名单尚未就绪');
   const directory=eventDirectory(events);
   const managers=new Map();
   const assigned=feedbackRoster(roster);
   for(const row of assigned){
    if(row.active!==true||row.emailVerified!==true)continue;
    const role=workspaceRosterEvidence(row.accountId,row.region,assigned,{complete:true});
    if(!role.verified||!['director','presidium'].includes(role.role))continue;
    const previous=managers.get(row.accountId);
    if(previous)previous.roles.push(role);
    else managers.set(row.accountId,{roles:[role],email:row.email});
   }
   for(const {id,eventId} of pending){
    assertRequestActive();
    const event=directory.get(eventId),recipients=event?[...managers].filter(([,manager])=>canView(manager.roles,event)):[];
    if(!recipients.length){await store.defer(id);continue;}
    let complete=true;
    for(const [actor,{email}] of recipients){
     assertRequestActive();
     if(!isValidDeliveryEmail(email)){complete=false;continue;}
     const receipt=createHash('sha256').update(JSON.stringify([id,actor])).digest('hex');
     if(await store.delivered(receipt))continue;
     const key=createHash('sha256').update(JSON.stringify([receipt,email])).digest('hex');
     const url=new URL('/console/activity-feedback',origin);url.searchParams.set('feedback',id);
     try{
      const result=await send({to:email,kind:'activity-feedback',idempotencyKey:`activity-feedback:${key}`,
       subject:'南大红会｜有新的活动反馈',text:`有一条活动反馈待查看，请登录管理端：\n${url}`});
      if(result?.ok&&['smtp','idempotent-skip'].includes(result.transport))await store.recordDelivery(receipt);
      else complete=false;
     }catch{complete=false;}
    }
    await (complete?store.complete(id):store.defer(id));
   }
  },
 };
}
