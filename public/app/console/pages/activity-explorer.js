import {h} from '../../core/dom.js';
import {badge} from '../../ui/primitives.js';
import {activityProjects} from '../../shared/activity-projects.js';
import {activityKind,activityRegion} from '../../shared/activity-taxonomy.js';

const config=row=>{try{return JSON.parse(row['报名页配置']||'{}');}catch{return {};}};
const object=row=>({id:row._id,name:row['活动名称'],status:row['状态']||'待配置',date:row['报名日期'],slot:row['报名时段'],location:row['地点'],category:row['活动类别'],center:row['组织类别']||config(row).center,region:row['活动地区']||config(row).region});
function matches(row,{mode,area,category,search}) {
 const status=row.status;
 const state=mode==='trash'?status==='已归档':status!=='已归档'&&(mode==='all'||mode==='review'&&['草稿','待审核'].includes(status)||mode==='mine'&&row.canReview||mode==='open'&&['报名中','进行中','停点'].includes(status)||mode==='sources'&&status==='待配置');
 return state&&(!category||activityKind({center:row.center||row.category})===activityKind({center:category}))&&(area==='all'||activityRegion({...row,type:row.category})===area)&&[row.name,row.date,row.slot,row.location,row.category,row.center].join(' ').toLowerCase().includes(search.trim().toLowerCase());
}

// Identity comes exclusively from the existing project model, never the display name.
export function explorerItems(events,sources,filters,{canReview=()=>false}={}) {
 const adopted=new Set(events.map(e=>config(e).source?.key).filter(Boolean));
 const projects=activityProjects(events).map(project=>{
  const sessions=project.sessions.filter(row=>!config(row).positionPlan).map(row=>({...object(row),canReview:canReview(row)}));
  const item={...object(project),name:project.projectName,sessions};
  // Match children so a review/open session is not hidden by its representative's status.
  return sessions.some(s=>matches({...s,name:project.projectName},filters))?item:null;
 }).filter(Boolean);
 return projects.concat(sources.filter(s=>!adopted.has(s.key)).map(s=>({id:s.key,name:s.name,status:'待配置',date:s.date,category:s.category,source:s.table,sessions:[]})).filter(s=>matches(s,filters)));
}

export function explorerRow(item,{selected,sessionDetail,expanded,onExpand,onSelect}) {
 const grouped=item.sessions.length>1;
 const current=sessionDetail?false:item.sessions.some(s=>s.id===selected)||item.id===selected;
 const text=h('button',{type:'button',class:'activity-list-item',data:{objectId:item.id},aria:{pressed:String(current)},on:{click:()=>onSelect(item.id,false)}},
  h('strong',{text:item.name,title:item.name}),
  h('span',{class:'activity-explorer-meta'},badge(item.status,{tone:item.status==='报名中'?'success':'neutral'}),h('span',{text:grouped?`${item.sessions.length} 个班次`:item.date||'日期待定'})),
  h('span',{class:'activity-explorer-caption',text:grouped?[item.sessions[0].date,item.sessions.at(-1).date].filter(Boolean).join(' — '):[item.slot,item.location||item.source].filter(Boolean).join(' · ')}));
 const children=h('div',{class:'activity-explorer-children',hidden:!expanded});
 if(expanded)for(const child of item.sessions)children.append(h('button',{type:'button',class:'activity-explorer-session',data:{objectId:child.id},aria:{pressed:String(sessionDetail&&child.id===selected)},on:{click:()=>onSelect(child.id,true)}},
  h('span',{class:'row-between'},h('strong',{text:child.date||'日期待定'}),badge(child.status)),h('span',{text:child.slot||'时段待定'}),h('small',{text:child.location||'地点待定'})));
 return h('section',{class:'activity-explorer-group'},h('div',{class:'activity-explorer-parent'},grouped?h('button',{type:'button',class:'activity-explorer-toggle',data:{toggleId:`toggle-${item.id}`},text:expanded?'−':'+',aria:{label:`${expanded?'收起':'展开'}${item.name}的班次`,expanded:String(expanded)},on:{click:onExpand}}):null,text),grouped?children:null);
}
