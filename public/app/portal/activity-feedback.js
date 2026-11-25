import {h} from '../core/dom.js';
import {getSessionState,request} from '../core/api.js';
import {reportError,notify} from '../core/toast.js';
import {button,field,runWithLoading} from '../ui/primitives.js';
import {openDrawer} from '../ui/overlay.js';
import {asyncRegion} from '../console/lib.js';
import {ACTIVITY_FEEDBACK_TEMPLATES} from '../shared/activity-feedback.js';

export function activityFeedbackButton(record){
 if(!record?.activityFeedback)return null;
 const label=()=>record.activityFeedback.submitted?'修改反馈':'填写反馈';
 const path=`/api/portal/workflow/activity-feedback?registration=${encodeURIComponent(record.code)}`;
 let busy=false;
 const trigger=button({label:label(),size:'sm',variant:'secondary',onClick:async()=>{
  if(busy)return;
  busy=true;
  try{
   const {name,template,result}=await runWithLoading(trigger,()=>request(path,{fresh:true}));
   const definition=ACTIVITY_FEEDBACK_TEMPLATES[template];
   const rating=template==='rating'?field({name:'rating',label:'评分',value:result?.rating??'',required:true,
    options:[{value:'',label:'请选择评分'},...[1,2,3,4,5].map(value=>({value,label:`${'★'.repeat(value)} ${value} 星`}))]}):null;
   const answers=definition.questions.map((question,index)=>field({name:`answer-${index}`,label:template==='ihl'?`${index+1}. ${question}`:question,
    value:result?.answers[index]||'',multiline:true,rows:3,maxlength:2000,required:template!=='rating'}));
   const fields=[...(rating?[rating]:[]),...answers];
   const form=h('form',{class:'stack-4'},h('p',{class:'t-secondary',text:name}),...fields);
   let drawer,saving=false;
   const save=button({label:result?'保存修改':'提交反馈',variant:'primary',onClick:async()=>{
    if(saving||!form.reportValidity())return;
    saving=true;
    try{
     await runWithLoading(save,()=>request(path,{method:'PUT',body:{version:result?.version||0,
      rating:rating?Number(rating.control.value):null,answers:answers.map(item=>item.control.value)}}));
     record.activityFeedback.submitted=true;
     trigger.querySelector('span:last-child').textContent=label();
     saving=false;
     await drawer.close();
     notify.success('活动反馈已保存');
    }catch(error){reportError(error,'反馈保存失败');}finally{saving=false;}
   }});
   form.addEventListener('submit',event=>{event.preventDefault();save.click();});
   drawer=openDrawer({title:definition.label,body:form,footer:[button({label:'关闭',onClick:()=>drawer.close()}),save],beforeClose:()=>!saving});
  }catch(error){reportError(error,'活动反馈读取失败');}finally{busy=false;}
 }});
 return trigger;
}

export function eventActivityFeedback(event){
 const ids=new Set([event.workflowId,...(event.sessions||[]).map(session=>session.sessionId)].filter(Boolean));
 if(!ids.size||!getSessionState().authenticated)return null;
 return asyncRegion({errorTitle:'活动反馈入口暂时无法加载',load:()=>request('/api/portal/workflow/me'),render:data=>{
  const rows=data.registrations.filter(row=>ids.has(row.eventId)&&row.activityFeedback);
  return rows.length?h('section',{class:'stack-3','aria-label':'活动反馈'},h('h2',{class:'t-h2',text:'活动反馈'}),
   ...rows.map(row=>h('div',{class:'row-2 row-wrap'},h('span',{text:[row.date,row.slot].filter(Boolean).join(' · ')}),activityFeedbackButton(row)))):h('div',{hidden:true});
 }});
}
