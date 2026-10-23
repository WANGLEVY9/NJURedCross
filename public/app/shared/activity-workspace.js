import { activityWindow, shanghaiInstant } from './activity-window.js';
import { ACTIVITY_CATEGORY_OPTIONS, canonicalActivityCategory } from './activity-taxonomy.js';

/** Workspace categories use canonical labels, not substring-based department guesses. */
export const WORKSPACE_CATEGORIES = ACTIVITY_CATEGORY_OPTIONS;
export const WORKSPACE_STAGES = Object.freeze(['草稿','待审批','报名中','进行中','时长审核','已结束']);
export const WORKSPACE_REGIONS = Object.freeze(['nanjing','suzhou']);
export function workspaceCategories(region) {
  return WORKSPACE_CATEGORIES.slice(0,region==='suzhou'?5:7);
}
export function workspaceStage(event, { hoursSubmitted=false,now=Date.now() }={}) {
  if(event['状态']==='草稿'||event['状态']==='待配置')return '草稿';
  if(['待审核','可发布'].includes(event['状态']))return '待审批';
  if(event['状态']==='报名中'){let c;try{c=JSON.parse(event['报名页配置']||'{}');}catch{c={};}return Date.parse(c.publishAt)>now?'待审批':'报名中';}
  if(['进行中','停点'].includes(event['状态'])){let c;try{c=JSON.parse(event['报名页配置']||'{}');}catch{c={};}return hoursSubmitted||c.runningReview?.status==='submitted'?'时长审核':'进行中';}
  return event['状态']==='已结束'?'已结束':null;
}

const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'activity_draft_invalid'});
const fields=['name','region','category','responsibleId','description','bookingMode','date','endDate','start','end','deadline','location','capacity','serviceHours','trainingHours','travelHours','work','notice','qqGroup','invitation','notes'];
export function workspaceReviewerIds(content){
 const ids=content.reviewerIds;
 if(ids===undefined)return undefined;
 if(!Array.isArray(ids)||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)))throw fail('审批人列表无效或重复');
 return [...ids];
}
export function workspaceResponsibleIds(content){
 if(content.responsibleIds===undefined)return content.responsibleId?[content.responsibleId]:[];
 const ids=content.responsibleIds;
 if(!Array.isArray(ids)||ids.length>21||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id)))throw fail('活动负责人列表无效或重复');
 return [...ids];
}
const positionFields=['id','name','date','start','end','campus','location','capacity','serviceHours','trainingHours','travelHours','work'];
const string=(value,label,max=500)=>{
  if(value===undefined)return '';
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw fail(`${label}格式无效`);
  return value.trim();
};
/** Incomplete input is allowed for saving, but identity, permissions and versions are not input. */
export function normalizeWorkspaceDraft(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>![...fields,'positions','responsibleIds','projectOwnerId','reviewerIds'].includes(k)))throw fail('草稿字段无效');
  const result={};
  for(const key of fields)result[key]=string(input[key],key,key==='notice'?10000:key==='description'?2000:500);
  if(input.projectOwnerId!==undefined){
   if(typeof input.projectOwnerId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.projectOwnerId))throw fail('立项负责人账号无效');
   result.projectOwnerId=input.projectOwnerId;
  }
  if(input.reviewerIds!==undefined)result.reviewerIds=workspaceReviewerIds(input);
  if(input.reviewerIds!==undefined&&input.projectOwnerId===undefined)throw fail('审批人选择须绑定立项负责人');
  if(input.responsibleIds!==undefined){
   result.responsibleIds=workspaceResponsibleIds(input);
   if(result.responsibleId&&result.responsibleId!==result.responsibleIds[0])throw fail('活动负责人字段不一致');
   result.responsibleId=result.responsibleIds[0]||'';
  }
  if(result.projectOwnerId&&result.responsibleId!==result.projectOwnerId)throw fail('立项负责人须与项目主负责人一致');
  result.category=canonicalActivityCategory(result.category);
  if(!result.name)throw fail('请填写活动名称');
  if(result.region&&!WORKSPACE_REGIONS.includes(result.region))throw fail('活动地区无效');
  if(result.category&&!workspaceCategories(result.region).includes(result.category))throw fail('活动地区与类别不匹配');
  if(result.bookingMode&&!['unified','grouped'].includes(result.bookingMode))throw fail('岗位数量选项无效');
  if(input.positions!==undefined&&(!Array.isArray(input.positions)||input.positions.length>200))throw fail('岗位数量无效');
  const ids=new Set();
  result.positions=(input.positions||[]).map(p=>{
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!positionFields.includes(k)))throw fail('岗位字段无效');
    const row=Object.fromEntries(positionFields.map(key=>[key,string(p[key],`岗位${key}`)]));
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)||ids.has(row.id))throw fail('岗位标识无效或重复');ids.add(row.id);return row;
  });
  if(result.bookingMode!=='grouped'&&result.positions.length)throw fail('当前岗位数量选项不能包含多岗位安排');
  return result;
}
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Boolean(shanghaiInstant(`${value}T00:00`));
const validTime=value=>/^\d{2}:\d{2}$/.test(value)&&Number(value.slice(0,2))<24&&Number(value.slice(3))<60;
function hoursError(value,optional=false){return optional&&value===''?false:value===''||!Number.isFinite(Number(value))||Number(value)<0;}
export function workspaceDraftErrors(input) {
  const d=normalizeWorkspaceDraft(input), errors=[];
  if(d.projectOwnerId&&!d.reviewerIds?.length)errors.push('请选择审批人');
  if(d.qqGroup&&!/^\d{5,30}$/.test(d.qqGroup))errors.push('QQ群号须为5至30位数字');
  if(d.invitation){try{const url=new URL(d.invitation);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('link');}catch{errors.push('邀请链接须为有效的HTTP或HTTPS网址');}}
  for(const [key,label]of [['region','活动地区'],['category','活动类别'],['bookingMode','岗位数量'],['notice','报名通知']])if(!d[key])errors.push(`请填写${label}`);
  if(!validDate(d.date)||!validDate(d.endDate)||d.endDate<d.date)errors.push('活动日期范围无效');
  const deadline=shanghaiInstant(d.deadline);if(!deadline)errors.push('报名截止时间无效');
  const check=(row,label,startDate,endDate)=>{
    if(!validTime(row.start)||!validTime(row.end)||!activityWindow(`${startDate}T${row.start}`,`${endDate}T${row.end}`))errors.push(`${label}起止时间无效`);
    if(deadline&&validTime(row.start)&&Date.parse(`${startDate}T${row.start}:00+08:00`)<=deadline.timestamp)errors.push(`${label}须在报名截止后开始`);
    for(const [key,name]of [['location','地点'],['work','工作内容']])if(!row[key])errors.push(`请填写${label}${name}`);
    if(!/^\d+$/.test(row.capacity)||!Number.isSafeInteger(Number(row.capacity))||Number(row.capacity)<1||Number(row.capacity)>100000)errors.push(`${label}人数无效`);
    if(hoursError(row.serviceHours)||Number(row.serviceHours)<=0||hoursError(row.trainingHours,true)||hoursError(row.travelHours,true))errors.push(`${label}时长无效`);
  };
  if(d.bookingMode==='unified')check(d,'活动',d.date,d.endDate);
  if(d.bookingMode==='grouped'){
    if(!d.positions.length)errors.push('请添加岗位');
    const keys=new Set();let total=0;
    for(const [i,p]of d.positions.entries()){
      if(!p.name)errors.push(`请填写岗位${i+1}名称`);
      if(!validDate(p.date)||p.date<d.date||p.date>d.endDate)errors.push(`岗位${i+1}日期须在活动范围内`);
      check(p,`岗位${i+1}`,p.date,p.date);total+=Number(p.capacity)||0;
      const key=JSON.stringify([p.name,p.date,p.start,p.end,p.location]);if(keys.has(key))errors.push('不能重复设置同一岗位');keys.add(key);
    }
    if(total>100000)errors.push('岗位总人数超过限制');
  }
  return errors;
}
/** Capabilities come exclusively from current server-side, region-bound roster evidence. */
export function workspacePermissions(event,evidence) {
  const unassigned=event.stage==='草稿'&&!event.region&&event.ownerId===evidence?.actor;
  const valid=evidence?.verified===true&&evidence?.active===true&&WORKSPACE_REGIONS.includes(evidence.region)&&(event.region===evidence.region||unassigned);
  const chair=valid&&['presidium','global'].includes(evidence.role);
  const owner=valid&&(evidence.actor===event.ownerId||workspaceResponsibleIds(event).includes(evidence.actor))&&(event.category?evidence.categories?.some(value=>canonicalActivityCategory(value)===canonicalActivityCategory(event.category)):event.stage==='草稿'&&evidence.categories?.length>0);
  const draft=event.stage==='草稿';
  return {view:Boolean(valid&&(chair||owner)),edit:Boolean(owner&&draft||chair&&['草稿','待审批','报名中'].includes(event.stage)),review:Boolean(chair&&event.stage==='待审批'),recordHours:Boolean(owner&&event.stage==='进行中'),reviewHours:Boolean(chair&&event.stage==='时长审核')};
}
export function workspaceNotice(input,{legacy=false,previous=false}={}) {
  const d=normalizeWorkspaceDraft(input),text=v=>v||'待补充';
  const dash=legacy?'—':'-',hours=p=>[`服务${text(p.serviceHours)}小时`,...(Number(p.trainingHours)>0?[`培训${p.trainingHours}小时`]:[]),...(Number(p.travelHours)>0?[`交通${p.travelHours}小时`]:[])].join('，');
  const old=legacy||previous,label=old?'工作内容':'活动内容';
  const lines=[old?`【${d.name}】`:`南大红会 ${d.name}`];
  if(d.description)lines.push(`【活动内容】${d.description}`);
  if(d.bookingMode==='grouped'){
    lines.push(`【${label}】`);
    for(const [i,p]of d.positions.entries())lines.push(`${i+1}. ${text(p.name)}`,`${label}：${text(p.work)}`,`活动时间：${text(p.date)} ${text(p.start)}${dash}${text(p.end)}`,`活动地点：${legacy&&p.campus?p.campus+'校区 · ':''}${text(p.location)}`,`招募人数：${text(p.capacity)}人`,...(legacy?[`志愿时长：${hours(p)}。`]:[]),'');
  }else lines.push(`【${label}】${text(d.work)}`,`【活动时间】${text(d.date)} ${text(d.start)}${dash}${d.endDate&&d.endDate!==d.date?d.endDate+' ':''}${text(d.end)}`,`【活动地点】${text(d.location)}`,`【招募人数】${text(d.capacity)}人`,...(legacy?[`【志愿时长】${hours(d)}。`]:[]));
  lines.push(`【报名截止】${text(d.deadline).replace('T',' ')}`,d.bookingMode==='grouped'?'【报名方式】请在平台活动页面选择相应岗位并提交报名。':'【报名方式】请在平台活动页面填写并提交报名。',...(!old?['https://njuredcross.cn/events']:[]),'【结果通知】报名审核结果将通过邮件通知，请留意查收；后续安排以活动通知为准。');return lines.join('\n');
}
export const isWorkspaceNoticeAuto=content=>!content.notice||content.notice===workspaceNotice(content)||content.notice===workspaceNotice(content,{legacy:true})||content.notice===workspaceNotice(content,{previous:true});
