import {h} from '../core/dom.js';
import {request,getSessionState} from '../core/api.js';
import {button,field,panel,notice,definitionList,checkbox,runWithLoading} from '../ui/primitives.js';
import {reportError,notify} from '../core/toast.js';
import {prepareAttendancePhoto} from './attendance-photo.js';

export async function specialRegistryPage(event){
 const node=h('div',{class:'view wspad special-registry-page stack-4'}),id=event.workflowId||event.id,root=`/api/portal/workflow/events/${encodeURIComponent(id)}`;
 const component=event.registryType==='component-donation'||event.type==='component-donation',content=h('div',{class:'stack-4'});
 node.append(h('header',{class:'row-between row-wrap'},h('div',{},h('p',{class:'t-caption',text:'活动广场 / 排班专项'}),h('h1',{text:event.name})),button({label:'返回活动广场',href:'/events'})),content);
 if(!getSessionState().authenticated){content.append(notice('登录后可使用已验证的个人档案填写登记。'),button({label:'登录后登记',variant:'primary',href:'/login?next='+encodeURIComponent('/events/'+event.eventId)}));return {title:event.name,node};}
 let requestId=crypto.randomUUID(),disposed=false;
 async function load(){
  const data=await request(root+'/registry',{fresh:true});if(disposed)return;
  const {participant,rows}=data,ended=data.event.status!=='进行中';
  const date=field({label:component?'实际献血日期':'服务日期',type:'date',required:true,max:component?new Date(Date.now()+8*3600000).toISOString().slice(0,10):undefined});
  const duration=field({label:'当天实际献血时长（不含交通时长）',type:'number',required:true,min:0.1,max:24,step:0.1}),quantity=field({label:'献血量',type:'number',required:true,min:1,max:1000,step:1,hint:'按献血证填写数字，与原表口径一致。'});
  const photo=h('input',{class:'input',type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'献血证截图或照片'}),consent=checkbox({label:'本人确认填写信息真实，并同意用于志愿服务登记与核验。'});
  const missing=participant.missing||[],feedback=h('div',{'aria-live':'polite'}),form=h('form',{class:'stack-3',on:{submit:e=>e.preventDefault()}});
  const submit=button({label:'提交登记',variant:'primary',disabled:ended||Boolean(missing.length),onClick:async()=>{
   if(!date.control.reportValidity()||!consent.control.checked||component&&(!duration.control.reportValidity()||!quantity.control.reportValidity())){if(!consent.control.checked)notify.warning('请确认登记信息与用途');return;}
   try{await runWithLoading(submit,async()=>{
    if(component){if(!photo.files?.[0])throw Error('请选择献血证截图或照片');const upload=await prepareAttendancePhoto(photo.files[0]);await request(root+'/registry-certificate?'+new URLSearchParams({requestId,date:date.control.value,duration:duration.control.value,quantity:quantity.control.value}),{method:'POST',form:upload,headers:{'Content-Type':upload.type}});}
    else await request(root+'/registry',{method:'POST',body:{requestId,date:date.control.value}});
   });requestId=crypto.randomUUID();notify.success('登记已提交，等待核验');await load();}catch(error){feedback.replaceChildren(notice(error.message||'登记未完成，请刷新核对后再重试',{tone:'warning'}));}
  }});
  form.append(date,...(component?[duration,quantity,h('label',{class:'field'},h('span',{class:'field__label',text:'献血证截图或照片（必填）'}),photo,h('small',{class:'t-caption',text:'可遮盖身份证号码等与核验无关的敏感信息。'}))]:[]),consent,submit,feedback);
  const records=h('div',{class:'activity-registration-table registry-table'},h('table',{class:'table'},h('thead',{},h('tr',{},...['日期',...(component?['实际时长','献血量']:[]),'状态','操作'].map(text=>h('th',{text})))),h('tbody',{},...rows.map(row=>{
   const state=row.registry?.state,actions=h('div',{class:'row-2 row-wrap'});
   if(state==='returned'&&!ended)actions.append(button({label:'修改后重新登记',size:'sm',onClick:()=>{requestId=crypto.randomUUID();date.control.value=row.date;if(component){duration.control.value=row.registry.duration;quantity.control.value=row.registry.quantity;}form.scrollIntoView({block:'start',behavior:'smooth'});date.control.focus();}}));
   if(component&&row.registry?.photoId)actions.append(button({label:'查看凭证',size:'sm',href:`/api/portal/workflow/registrations/${encodeURIComponent(row.code)}/registry-certificate`}));
   if(!component&&row.status==='已确认'){
    const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'签到凭证 '+row.date});
    const upload=button({label:'上传签到凭证',size:'sm',onClick:async()=>{try{if(!file.files?.[0])throw Error('请选择签到凭证');await runWithLoading(upload,async()=>{const image=await prepareAttendancePhoto(file.files[0]);return request(`/api/portal/workflow/registrations/${encodeURIComponent(row.code)}/attendance`,{method:'POST',form:image,headers:{'Content-Type':image.type}});});notify.success('凭证已提交，等待核验');await load();}catch(error){reportError(error,'凭证未提交');}}});actions.append(file,upload);
   }
   return h('tr',{},h('td',{text:row.date}),...(component?[h('td',{text:row.registry?.duration}),h('td',{text:row.registry?.quantity})]:[]),h('td',{text:state==='verified'?(row.hasHours?'已核验 · 时长已处理':'已核验'):state==='returned'?'已退回：'+(row.registry.reason||'请联系管理员'):'待核验'}),h('td',{},actions));
  }))));
  content.replaceChildren(panel({title:component?'成分献血 · 完成登记':'省血液献血车 · 服务登记',body:h('div',{class:'stack-3'},h('p',{class:'workflow-copy',text:data.event.notice||'长期开放，个人资料由账号档案自动带入。'}),definitionList([['姓名',participant.realName],['学号',participant.studentId],['部门',participant.department],['邮箱',participant.email],['校区',participant.campus]]),ended?notice('项目已结束登记，已有记录仍可查看。'):missing.length?h('div',{class:'stack-2'},notice('请先补全：'+missing.join('、'),{tone:'warning'}),button({label:'完善个人资料',href:'/me'})):form)}),panel({title:`我的登记（${rows.length}）`,body:rows.length?records:notice('暂无登记记录',{tone:'neutral'})}));
 }
 try{await load();}catch(error){content.replaceChildren(notice(error.message||'登记信息加载失败',{tone:'warning'}),button({label:'重试',onClick:()=>load().catch(error=>reportError(error,'读取失败'))}));}
 return {title:event.name,node,dispose:()=>{disposed=true;}};
}
