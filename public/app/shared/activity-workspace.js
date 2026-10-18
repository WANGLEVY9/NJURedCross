import { activityWindow, shanghaiInstant } from './activity-window.js';
import { ACTIVITY_CATEGORY_OPTIONS } from './activity-taxonomy.js';

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
  if(['进行中','停点'].includes(event['状态']))return hoursSubmitted?'时长审核':'进行中';
  return event['状态']==='已结束'?'已结束':null;
}

const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'activity_draft_invalid'});
const fields=['name','region','category','responsibleId','description','bookingMode','date','endDate','start','end','deadline','location','capacity','serviceHours','trainingHours','travelHours','work','notice'];
const positionFields=['id','name','date','start','end','campus','location','capacity','serviceHours','trainingHours','travelHours','work'];
const string=(value,label,max=500)=>{
  if(value===undefined)return '';
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw fail(`${label}格式无效`);
  return value.trim();
};
/** Incomplete input is allowed for saving, but identity, permissions and versions are not input. */
export function normalizeWorkspaceDraft(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>![...fields,'positions'].includes(k)))throw fail('草稿字段无效');
  const result={};
  for(const key of fields)result[key]=string(input[key],key,key==='notice'?10000:key==='description'?2000:500);
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
      if(!['鼓楼','仙林','浦口','苏州'].includes(p.campus)||d.region==='suzhou'&&p.campus!=='苏州'||d.region==='nanjing'&&p.campus==='苏州')errors.push(`岗位${i+1}校区与地区不匹配`);
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
  const chair=valid&&evidence.role==='presidium';
  const owner=valid&&evidence.actor===event.ownerId&&(event.category?evidence.categories?.includes(event.category):event.stage==='草稿'&&evidence.categories?.length>0);
  const draft=event.stage==='草稿';
  return {view:Boolean(valid&&(chair||owner)),edit:Boolean(owner&&draft||chair&&['草稿','待审批','报名中'].includes(event.stage)),review:Boolean(chair&&event.stage==='待审批'),recordHours:Boolean(owner&&event.stage==='进行中'),reviewHours:Boolean(chair&&event.stage==='时长审核')};
}
export function workspaceNotice(input) {
  const d=normalizeWorkspaceDraft(input),text=v=>v||'待补充';
  const lines=[`【活动名称】${d.name}`,`【活动日期】${text(d.date)}${d.endDate&&d.endDate!==d.date?' 至 '+d.endDate:''}`];
  if(d.description)lines.push(`【活动简介】${d.description}`);
  if(d.bookingMode==='grouped')for(const [i,p]of d.positions.entries())lines.push(`【岗位${i+1}】${text(p.name)}`,`时间：${text(p.date)} ${text(p.start)}—${text(p.end)}`,`地点：${text(p.location)}`,`人数：${text(p.capacity)} 人`,`工作内容：${text(p.work)}`,`服务 / 培训 / 交通时长：${text(p.serviceHours)} / ${p.trainingHours||'0'} / ${p.travelHours||'0'} 小时`);
  else lines.push(`【活动时间】${text(d.date)} ${text(d.start)}—${text(d.endDate)} ${text(d.end)}`,`【活动地点】${text(d.location)}`,`【招募人数】${text(d.capacity)}`,`【工作内容】${text(d.work)}`);
  lines.push(`【报名截止】${text(d.deadline).replace('T',' ')}`,'【报名方式】登录平台活动页面报名。');return lines.join('\n');
}
