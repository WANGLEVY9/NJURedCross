import {h} from '../../core/dom.js';
import {downloadFile,request} from '../../core/api.js';
import {reportError,notify} from '../../core/toast.js';
import {button,field,pageHead,notice,badge,definitionList,runWithLoading} from '../../ui/primitives.js';
import {openDrawer} from '../../ui/overlay.js';
import {asyncRegion} from '../lib.js';
import {ACTIVITY_FEEDBACK_TEMPLATES} from '../../shared/activity-feedback.js';

const endpoint='/api/console/activity-feedback';
const option=(value,label)=>({value,label});
const distinct=options=>[...new Map(options.map(entry=>[entry.value,entry])).values()];

export default function activityFeedbackPage({query}={}){
 const filters={department:'',project:'',event:'',template:'',feedback:query?.get('feedback')||'',page:'1'};
 const api=(overrides={})=>`${endpoint}?${new URLSearchParams({...filters,...overrides})}`;
 const view=asyncRegion({load:()=>request(api(),{fresh:true}),errorTitle:'活动反馈暂时无法加载',render:({items,events,page,hasNext})=>{
  const select=(name,label,choices,clear=[])=>field({name,label,value:filters[name],options:[option('','全部'),...distinct(choices)],onInput:event=>{
   filters[name]=event.target.value;
   for(const key of clear)filters[key]='';
   filters.feedback='';filters.page='1';void view.reload();
  }});
  const departmentEvents=events.filter(event=>!filters.department||event.department===filters.department);
  const projectEvents=departmentEvents.filter(event=>!filters.project||event.project===filters.project);
  const filterBar=h('div',{class:'row-3 row-wrap'},
   select('department','部门',events.map(event=>option(event.department,event.department)),['project','event']),
   select('project','项目',departmentEvents.map(event=>option(event.project,event.projectName)),['event']),
   select('event','活动',projectEvents.map(event=>option(event.id,[event.date,event.title].filter(Boolean).join(' · ')))),
   select('template','模板',Object.entries(ACTIVITY_FEEDBACK_TEMPLATES).map(([key,value])=>option(key,value.label))));
  const exportButton=button({label:'导出 CSV',disabled:!items.length,onClick:async()=>{
   try{await runWithLoading(exportButton,()=>downloadFile(api({export:'csv'}),'活动反馈.csv'));}catch(error){reportError(error,'活动反馈导出失败');}
  }});
  const open=item=>{
   const definition=ACTIVITY_FEEDBACK_TEMPLATES[item.template];
   let drawer;
   const readButton=button({label:'标为已读',variant:'primary',onClick:async()=>{
    try{
     await runWithLoading(readButton,()=>request(endpoint,{method:'POST',body:{id:item.id}}));
     await drawer.close();await view.reload();notify.success('反馈已标为已读');
    }catch(error){reportError(error,'标记已读失败');}
   }});
   drawer=openDrawer({title:item.event.title,body:h('div',{class:'stack-4'},
    definitionList([['提交人',item.name],['部门',item.event.department],['模板',definition.label],['评分',item.rating==null?'—':`${item.rating} 星`]]),
    ...item.answers.map((text,i)=>h('section',{class:'stack-1'},h('h3',{class:'t-h3',text:`${i+1}. ${definition.questions[i]}`}),
     ...String(text||'—').split('\n').map(line=>h('p',{class:'t-secondary',text:line}))))),
    footer:[button({label:'关闭',onClick:()=>drawer.close()}),item.reviewed?null:readButton].filter(Boolean)});
  };
  const changePage=next=>{filters.page=String(next);void view.reload();};
  return h('div',{class:'stack-4'},filterBar,h('div',{class:'row-3 row-wrap'},exportButton,
   filters.feedback?button({label:'查看全部反馈',onClick:()=>{filters.feedback='';void view.reload();}}):null),
   ...(items.length?items.map(item=>h('article',{class:'panel'},h('div',{class:'panel__body row-between row-wrap'},
    h('div',{class:'stack-1'},h('strong',{text:item.event.title}),h('p',{class:'t-caption',text:[item.event.department,item.event.projectName,item.name].join(' · ')})),
    h('div',{class:'row-2 row-wrap'},badge(ACTIVITY_FEEDBACK_TEMPLATES[item.template].label),item.rating!=null?badge(`${item.rating} 星`):null,
     item.reviewed?null:badge('待阅',{tone:'warning'}),button({label:'查看全文',onClick:()=>open(item)}))))):[notice('当前筛选下没有可查看的活动反馈。')]),
   page>1||hasNext?h('div',{class:'row-3'},button({label:'上一页',disabled:page<=1,onClick:()=>changePage(page-1)}),
    h('span',{text:`第 ${page} 页`}),button({label:'下一页',disabled:!hasNext,onClick:()=>changePage(page+1)})):null);
 }});
 return {title:'活动反馈',node:h('div',{class:'view wspad wspad--wide stack-5'},pageHead({title:'活动反馈'}),view)};
}
