import {ACTIVITY_TAG_GROUPS,activityTagGroup} from '../../public/app/shared/activity-taxonomy.js';
import {activityProjectKey} from '../../public/app/shared/activity-projects.js';
import {workflowConfig} from './blood-roster.js';

export const HELD_ACTIVITY_CRITERION='暂按已结束且至少有一条已核验签到计算';
export const actuallyHeldActivity=({sessions,participations})=>
  sessions.length>0&&sessions.every(row=>row['状态']==='已结束')&&participations>0;

const totals=()=>({held:0,applicants:0,participations:0});
function sum(details){
 const result=totals();
 for(const detail of details)for(const key of Object.keys(result))result[key]+=detail[key];
 return result;
}

export function activityStatistics(snapshot,{regions,tag,held=actuallyHeldActivity}){
 const rows=snapshot.events.filter(row=>!row.sourceSuperseded&&!row.relationshipError&&!row.configurationError);
 const configs=new Map(rows.map(row=>[row['活动ID'],workflowConfig(row)]));
 const excluded=new Set(rows.filter(row=>row['状态']==='已删除').flatMap(row=>[row['活动ID'],...(configs.get(row['活动ID'])?.sourceActivityIds||[])]));
 const scheduleRoots=new Set(rows.map(row=>configs.get(row['活动ID'])?.special?.rootId).filter(Boolean));
 const projects=new Map(),byActivityId=new Map();
 for(const row of rows){
  const id=row['活动ID'],config=configs.get(id);
  if(!id||excluded.has(id)||['草稿','待审核','待配置','已归档'].includes(row['状态'])||scheduleRoots.has(id))continue;
  const sourceRegion=row['活动地区']||config?.region;
  const region=['suzhou','苏州地区','苏州活动'].includes(sourceRegion)?'suzhou'
   :['nanjing','南京地区','南京活动'].includes(sourceRegion)?'nanjing':null;
  if(!regions.includes(region))continue;
  const key=activityProjectKey(row);
  if(!projects.has(key))projects.set(key,{key,sessions:[],applicants:new Set(),attended:new Set(),row});
  const project=projects.get(key);
  project.sessions.push(row);
  if(config?.positionPlan)project.row=row;
  byActivityId.set(id,project);
  for(const alias of config?.sourceActivityIds||[])if(!excluded.has(alias))byActivityId.set(alias,project);
 }
 const checked=new Map();
 for(const row of snapshot.checkins)if(row['核验人']&&row['报名行ID']){
  const project=byActivityId.get(row['活动ID']);
  if(project)checked.set(row['报名行ID'],project);
 }
 for(const row of snapshot.registrations){
  const project=byActivityId.get(row['活动ID']);
  if(!project)continue;
  const student=String(row['学号']||'').trim(),account=String(row['账号ID']||'').trim();
  if(student||account||row._id)project.applicants.add(student?'student:'+student:account?'account:'+account:'row:'+row._id);
  if(row._id&&row['报名状态']==='已签到'&&checked.get(row._id)===project)project.attended.add(row._id);
 }
 const details=new Map();
 for(const project of projects.values()){
  const row=project.row,config=configs.get(row['活动ID']),parent=configs.get(config?.parentActivityId||config?.special?.rootId);
  const rawTag=parent?.activityTag||config?.activityTag||row['活动标签'];
  const item=activityTagGroup(rawTag)?rawTag:'未分类';
  const participations=project.attended.size;
  const entry={id:row._id,name:row['活动名称'],date:row['报名日期'],held:Number(held({sessions:project.sessions.filter(r=>!configs.get(r['活动ID'])?.positionPlan),participations})),
   applicants:project.applicants.size,participations};
  if(!details.has(item))details.set(item,[]);
  details.get(item).push(entry);
 }
 const groups=[...ACTIVITY_TAG_GROUPS,{name:'未分类',tags:['未分类']}].map(group=>{
  const items=group.tags.map(name=>({name,...sum(details.get(name)||[])}));
  return {name:group.name,items,...sum(items)};
 });
 return {criterion:HELD_ACTIVITY_CRITERION,groups,totals:sum(groups),details:tag?[...(details.get(tag)||[])].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))):undefined};
}
