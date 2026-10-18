import {h} from '../../core/dom.js';
import {button,field,definitionList} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {registrationCapacity} from '../../shared/activity-registration.js';

/** Registration-only workspace. The host supplies fresh scoped detail and mutations. */
export function activityRegistrationWorkspace({event,data,actionsNode,decide,close,reload,onChanged=()=>{}}){
 let snapshot=data,busy=false,disposed=false,uncertain=false;
 const selected=new Set(),records=h('tbody'),summary=h('span',{class:'t-caption',role:'status'});
 const root=h('div',{class:'activity-registration-workspace'}),content=h('div',{class:'activity-registration-content'});
 let activePosition='';
 const positionTabs=h('div',{class:'activity-registration-positions',role:'tablist','aria-label':'活动岗位'});
 function positions(){return snapshot.events.filter(e=>{try{return JSON.parse(e['报名页配置']||'{}').bookingMode!=='grouped';}catch{return false;}});}
 const positionRows=()=>snapshot.registrations.filter(r=>r['活动ID']===activePosition);
 function switchPosition(id){if(busy)return;activePosition=id;selected.clear();render();}

 const status=field({label:'报名状态',options:[{value:'',label:'全部状态'},{value:'待筛选',label:'待判定'},{value:'已确认',label:'报名成功'},{value:'未入选',label:'报名失败'},{value:'已请假',label:'已请假'}]});
 const current=()=>snapshot.events.find(e=>e._id===event._id)||event;
 const manager=()=>current().approvalAccess?.canManageRegistration===true&&current()['状态']==='报名中';
 const parent=r=>snapshot.events.find(e=>e['活动ID']===r['活动ID']);
 const eligible=r=>manager()&&parent(r)?.approvalAccess?.canManageRegistration===true&&parent(r)['状态']==='报名中'&&r['报名状态']==='待筛选'&&r['请假状态']!=='待审批';
 const visible=()=>positionRows().filter(r=>(!status.control.value||(status.control.value==='已确认'?['已确认','已签到'].includes(r['报名状态']):r['报名状态']===status.control.value)));
 function locked(control,value){control.disabled=value;control.setAttribute('aria-disabled',String(value));}
 function render(){
  const jobs=positions();if(!jobs.some(e=>e['活动ID']===activePosition))activePosition=jobs[0]?.['活动ID']||'';
  positionTabs.hidden=jobs.length<2;
  positionTabs.replaceChildren(...jobs.map((e,index)=>{
    const tab=button({label:e['岗位']||e['活动名称']||`岗位 ${index+1}`,onClick:()=>switchPosition(e['活动ID'])});
    tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(activePosition===e['活动ID']));tab.tabIndex=activePosition===e['活动ID']?0:-1;tab.disabled=busy;
    tab.addEventListener('keydown',ev=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(ev.key)||busy)return;ev.preventDefault();const next=ev.key==='Home'?0:ev.key==='End'?jobs.length-1:(index+(ev.key==='ArrowRight'?1:-1)+jobs.length)%jobs.length;switchPosition(jobs[next]['活动ID']);positionTabs.children[next]?.focus();});return tab;
  }));
  const rows=visible(),all=positionRows(),confirmed=all.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length,pending=all.filter(r=>r['报名状态']==='待筛选').length;
  const full=jobs.filter(e=>e['活动ID']===activePosition&&e['状态']==='报名中').filter(e=>registrationCapacity(e,all).full);
  summary.textContent=`报名 ${all.length} 人 · 成功 ${confirmed} 人 · 待判定 ${pending} 人${full.length?' · '+'报名已满':''}`;
  records.replaceChildren(...rows.map(r=>{
   const e=parent(r),check=h('input',{type:'checkbox','aria-label':`选择${r['姓名']||'报名人'}`,checked:selected.has(r._id),disabled:busy||uncertain||!eligible(r),on:{change:ev=>{if(ev.target.checked)selected.add(r._id);else selected.delete(r._id);render();}}});
   const state=r['报名状态']==='待筛选'?'待判定':r['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(r['报名状态'])?'报名成功':r['报名状态'];
   const decision=h('div',{class:'row-2'},h('span',{text:state}));
   if(eligible(r))for(const [kind,label] of [['confirm','报名成功'],['reject','报名失败']]){const b=button({label,size:'sm',onClick:()=>submit([r],kind)});locked(b,busy||uncertain);decision.append(b);}
   return h('tr',{},h('td',{},check),...['姓名','学号','校区'].map(key=>h('td',{text:r[key]||'—'})),h('td',{text:[e?.['岗位']||r['岗位'],r['报名日期']||e?.['报名日期'],r['报名时段']||e?.['报名时段']].filter(Boolean).join(' · ')||'—'}),h('td',{},decision));
  }));
  if(!rows.length)records.append(h('tr',{},h('td',{colspan:6,text:'暂无符合条件的报名'})));
  locked(success,busy||uncertain||!manager()||!selected.size);locked(failure,busy||uncertain||!manager()||!selected.size);locked(cutoff,busy||uncertain||!manager());
 }
 async function fresh(){snapshot=await reload();if(disposed)return;selected.clear();render();onChanged(snapshot);}
 async function commit(rows,kind,reason=''){
  if(busy||uncertain||disposed)return;busy=true;render();
  try{
   for(const e of snapshot.events){const ids=rows.filter(r=>r['活动ID']===e['活动ID']).map(r=>r._id);if(ids.length)await decide(e,ids,kind,reason);}
   await fresh();notify.success('报名结果已保存，通知已进入发送流程');
  }catch(error){uncertain=true;reportError(error,'请刷新核对已保存结果后再操作');try{await fresh();uncertain=false;}catch{/* Keep writes blocked until an authoritative refresh succeeds. */}}
  finally{busy=false;if(!disposed)render();}
 }
 async function submit(rows,kind){
  rows=rows.filter(eligible);if(!rows.length||busy||uncertain)return;
  if(rows.length>100){notify.warning('每次最多处理100人');return;}
  if(kind==='confirm'){if(await confirmAction({title:`确认 ${rows.length} 人报名成功？`,description:'确认后发送成功邮件。',confirmLabel:'确认成功并通知'}))await commit(rows,kind);return;}
  const reason=field({label:'失败原因',value:'很遗憾的通知您，您报名的活动已满',multiline:true,required:true,maxlength:500});let dialog;
  dialog=openModal({title:'报名失败',body:reason,footer:[button({label:'取消',onClick:()=>dialog.close()}),button({label:'确认失败并通知',variant:'primary',onClick:async()=>{if(!reason.control.reportValidity()||!reason.control.value.trim())return;const text=reason.control.value.trim();await dialog.close();await commit(rows,kind,text);}})]});
 }
 const success=button({label:'批量报名成功',onClick:()=>submit(snapshot.registrations.filter(r=>selected.has(r._id)),'confirm')});
 const failure=button({label:'批量报名失败',onClick:()=>submit(snapshot.registrations.filter(r=>selected.has(r._id)),'reject')});
 const cutoff=button({label:'报名截止',variant:'primary',onClick:async()=>{
  if(busy||uncertain||!manager())return;
  if(snapshot.registrations.some(r=>r['请假状态']==='待审批'||!['已确认','已签到','未入选','已请假'].includes(r['报名状态']))){openModal({title:'暂不能截止报名',body:h('p',{text:'请先完成所有有效报名的成功／失败判定，并处理待审批请假。'}),footer:[]});return;}
  if(!await confirmAction({title:'截止报名？',description:'截止后进入进行中。',confirmLabel:'确认截止'}))return;
  busy=true;render();try{await close();await fresh();}catch(error){reportError(error,'截止结果请刷新核对');}finally{busy=false;if(!disposed)render();}
 }});
 const view=button({label:'活动信息查看',onClick:()=>openModal({title:'活动信息',body:definitionList([['活动名称',current()['活动名称']],['日期',current()['报名日期']],['时段',current()['报名时段']],['地点',current()['地点']],['工作内容',current()['工作内容']],['通知',current()['通知草稿']]]),footer:[]})});
 const edit=button({label:'活动信息修改'});locked(edit,true);edit.title='当前工作区暂未开放发布后的信息修改';
 const selectAll=button({label:'选择当前筛选结果',onClick:()=>{for(const r of visible().filter(eligible))selected.add(r._id);render();}});
 const clear=button({label:'清除选择',onClick:()=>{selected.clear();render();}});
 for(const control of [status.control])control.addEventListener('change',()=>{selected.clear();render();});
 const refresh=button({label:'刷新名单',onClick:async()=>{if(busy)return;busy=true;try{await fresh();uncertain=false;}catch(error){reportError(error,'名单刷新失败');}finally{busy=false;if(!disposed)render();}}});
 content.append(positionTabs,h('div',{class:'activity-registration-filters'},status,summary),h('div',{class:'row-2 row-wrap'},selectAll,clear,success,failure,refresh),h('div',{class:'activity-registration-table'},h('table',{},h('thead',{},h('tr',{},...['选择','姓名','学号','校区','岗位与时间','报名状态'].map(text=>h('th',{scope:'col',text})))),records)));
 root.append(h('div',{class:'activity-draft-toolbar'},view,edit,cutoff,actionsNode),content);render();
 return {node:root,dispose:()=>{disposed=true;},hasUnsaved:()=>false,isSaving:()=>busy};
}
