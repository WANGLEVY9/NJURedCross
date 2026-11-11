import {PROVINCE_SERVICE_LOCATIONS} from '../shared/special-activity.js';
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
  const autoNotices=['长期开放。请选择服务日期登记，个人信息由已验证账号档案自动带入。','长期开放。服务完成后填写日期、服务时间及岗位，并上传签到凭证。个人资料由账号自动带入。','长期开放。请在实际献血完成后登记；实际献血时长不含交通时长。献血证截图可遮盖身份证号码等敏感信息。'];
  const customNotice=autoNotices.includes(data.event.notice)?'':String(data.event.notice||'').split('\n').filter(line=>!line.includes('table.nju.edu.cn/')).join('\n');
  const date=field({label:component?'实际献血日期':'服务日期',type:'date',required:true,max:new Date(Date.now()+8*3600000).toISOString().slice(0,10)});
  const duration=field({label:'当天实际献血时长（不含交通时长）',type:'number',required:true,min:0.1,max:24,step:0.1}),quantity=field({label:'献血量',type:'number',required:true,min:1,max:1000,step:1,hint:'按献血证填写数字，与原表口径一致。'});
  const start=field({label:'服务开始时间',type:'time',required:true}),end=field({label:'服务结束时间',type:'time',required:true}),location=field({label:'服务岗位',required:true,options:[{value:'',label:'请选择岗位'},...PROVINCE_SERVICE_LOCATIONS.map(value=>({value,label:value}))]});
  const photo=h('input',{class:'input',type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':component?'献血证截图或照片':'签到凭证'}),consent=checkbox({label:'本人确认填写信息真实，并同意用于志愿服务登记与核验。'});
  const missing=participant.missing||[],feedback=h('div',{'aria-live':'polite'}),form=h('form',{class:'stack-3',on:{submit:e=>e.preventDefault()}});
  const submit=button({label:'提交登记',variant:'primary',disabled:ended||Boolean(missing.length),onClick:async()=>{
   if(!date.control.reportValidity()||!consent.control.checked||(component?(!duration.control.reportValidity()||!quantity.control.reportValidity()):(!start.control.reportValidity()||!end.control.reportValidity()||!location.control.reportValidity()))){if(!consent.control.checked)notify.warning('请确认登记信息与用途');return;}
   try{await runWithLoading(submit,async()=>{
    if(!photo.files?.[0])throw Error(component?'请选择献血证截图或照片':'请选择签到凭证');
    const upload=await prepareAttendancePhoto(photo.files[0]),fields={requestId,date:date.control.value,...(component?{duration:duration.control.value,quantity:quantity.control.value}:{start:start.control.value,end:end.control.value,location:location.control.value})};
    await request(root+'/registry-certificate?'+new URLSearchParams(fields),{method:'POST',form:upload,headers:{'Content-Type':upload.type}});
   });requestId=crypto.randomUUID();notify.success('登记已提交，等待核验');await load();}catch(error){feedback.replaceChildren(notice(error.message||'登记未完成，请刷新核对后再重试',{tone:'warning'}));}
  }});
  form.append(h('div',{class:'registry-form-grid'},date,...(component?[duration,quantity]:[location,start,end])),h('label',{class:'field registry-proof'},h('span',{class:'field__label',text:component?'献血证截图或照片（必填）':'签到凭证（必填）'}),photo,h('small',{class:'t-caption',text:'支持照片或截图，可遮盖身份证号码等与核验无关的信息。'})),consent,h('div',{class:'registry-form-submit'},submit),feedback);
  const records=h('div',{class:'activity-registration-table registry-table'},h('table',{class:'table'},h('thead',{},h('tr',{},...['日期',...(component?['实际时长','献血量']:['服务时间','岗位']),'状态','操作'].map(text=>h('th',{text})))),h('tbody',{},...rows.map(row=>{
   const state=row.registry?.state,actions=h('div',{class:'row-2 row-wrap'});
   if(state==='returned'&&!ended)actions.append(button({label:'修改后重新登记',size:'sm',onClick:()=>{requestId=crypto.randomUUID();date.control.value=row.date;if(component){duration.control.value=row.registry.duration;quantity.control.value=row.registry.quantity;}else{start.control.value=row.registry?.start||'';end.control.value=row.registry?.end||'';location.control.value=row.registry?.location||'';}form.scrollIntoView({block:'start',behavior:'smooth'});date.control.focus();}}));
   if(row.registry?.photoId)actions.append(button({label:'查看凭证',size:'sm',href:`/api/portal/workflow/registrations/${encodeURIComponent(row.code)}/registry-certificate`}));
   if(!component&&row.status==='已确认'){
    const file=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'签到凭证 '+row.date});
    const upload=button({label:'上传签到凭证',size:'sm',onClick:async()=>{try{if(!file.files?.[0])throw Error('请选择签到凭证');await runWithLoading(upload,async()=>{const image=await prepareAttendancePhoto(file.files[0]);return request(`/api/portal/workflow/registrations/${encodeURIComponent(row.code)}/attendance`,{method:'POST',form:image,headers:{'Content-Type':image.type}});});notify.success('凭证已提交，等待核验');await load();}catch(error){reportError(error,'凭证未提交');}}});actions.append(file,upload);
   }
   return h('tr',{},h('td',{text:row.date}),...(component?[h('td',{text:row.registry?.duration}),h('td',{text:row.registry?.quantity})]:[h('td',{text:row.registry?.start?row.registry.start+'–'+row.registry.end:'—'}),h('td',{text:row.registry?.location||'—'})]),h('td',{text:state==='verified'?(row.hasHours?'已核验 · 时长已处理':'已核验'):state==='returned'?'已退回：'+(row.registry.reason||'请联系管理员'):'待核验'}),h('td',{},actions));
  }))));
  content.replaceChildren(panel({title:component?'成分献血 · 完成登记':'省血液献血车 · 服务登记',body:h('div',{class:'stack-3'},h('section',{class:'registry-introduction stack-2'},h('h3',{class:'t-title',text:'参与说明'}),h('p',{class:'workflow-copy',text:component?'长期开放 · 南京红十字血液中心。请按血液中心要求自行预约，完成献血后在此登记；本页不办理献血预约。':'长期开放 · 请在服务完成后填写实际日期、服务时间和岗位，并上传签到凭证。'}),...(component?[h('p',{class:'t-caption',text:'自行前往的去程车费可按血液中心规定报销（上限60元）；献血完毕后有班车送至地铁站。志愿时长、交通补贴、劳务补助、餐饮、保险及用血优惠按活动实际规定执行。'})]:[]),h('p',{class:'t-caption',text:'登记后由负责人核验凭证、确认时长，经终审后统一处理；提交登记不代表时长已入账。'}),customNotice?h('p',{class:'workflow-copy',text:customNotice}):null),h('details',{class:'registry-profile'},h('summary',{text:`个人档案 · ${participant.realName} · ${participant.studentId}`}),definitionList([['姓名',participant.realName],['学号',participant.studentId],['部门',participant.department],['邮箱',participant.email],['校区',participant.campus]])),ended?notice('项目已结束登记，已有记录仍可查看。'):missing.length?h('div',{class:'stack-2'},notice('请先补全：'+missing.join('、'),{tone:'warning'}),button({label:'完善个人资料',href:'/me'})):form)}),panel({title:`我的登记（${rows.length}）`,body:rows.length?records:notice('暂无登记记录',{tone:'neutral'})}));
 }
 try{await load();}catch(error){content.replaceChildren(notice(error.message||'登记信息加载失败',{tone:'warning'}),button({label:'重试',onClick:()=>load().catch(error=>reportError(error,'读取失败'))}));}
 return {title:event.name,node,dispose:()=>{disposed=true;}};
}
