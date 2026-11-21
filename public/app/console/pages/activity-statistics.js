import {request} from '../../core/api.js';
import {h} from '../../core/dom.js';
import {buildPath} from '../../core/router.js';
import {button,emptyState,notice,pageHead} from '../../ui/primitives.js';

const metricText=row=>'实际举办活动数 '+row.held+' · 报名人数 '+row.applicants+' · 实际参与人次 '+row.participations;
const endpoint='/api/volunteer/workflow/activity-statistics';

export function activityStatisticsPage(context){
 const content=h('div',{class:'stack-3','aria-live':'polite'});
 const back=button({label:'返回活动管理',href:context.path,variant:'secondary'});
 const node=h('div',{class:'view wspad'},pageHead({title:'分类统计',actions:[back]}),content);
 let sequence=0;
 async function load(tag){
  const current=++sequence;
  const detail=h('div',{class:'stack-2','aria-live':'polite',data:{statisticsDetail:''}},'正在加载活动明细…');
  if(tag){content.querySelector('[data-statistics-detail]')?.remove();content.append(detail);}
  else content.replaceChildren(h('p',{text:'正在加载分类统计…'}));
  try{
   const {result}=await request(endpoint+(tag?'?tag='+encodeURIComponent(tag):''));
   if(current!==sequence)return;
   if(tag){
    const rows=result.details.map(row=>h('li',{},
     button({label:row.name||'查看活动',href:buildPath(context.path,{event:row.id}),variant:'ghost'}),
     h('p',{class:'t-caption',text:[row.date,metricText(row)].filter(Boolean).join(' · ')})));
    detail.replaceChildren(h('h3',{text:tag+' · 活动明细'}),rows.length?h('ul',{},...rows):emptyState({title:'此分类暂无活动'}));
    return;
   }
   const groups=result.groups.map(group=>h('details',{},h('summary',{text:group.name+' · '+metricText(group)}),
    h('ul',{},...group.items.map(item=>h('li',{},button({label:item.name+' · '+metricText(item),variant:'ghost',onClick:()=>load(item.name)}))))));
   content.replaceChildren(notice(result.criterion+'。报名人数按同一活动中的人员去重，实际参与人次按已核验的报名行计数。',{tone:'info'}),
    h('p',{text:metricText(result.totals)}),...groups);
  }catch(error){
   if(current===sequence)(tag?detail:content).replaceChildren(notice(error.message||'分类统计加载失败',{tone:'warning'}));
  }
 }
 void load();
 return {title:'分类统计',crumb:'分类统计',node,dispose:()=>{sequence++;}};
}
