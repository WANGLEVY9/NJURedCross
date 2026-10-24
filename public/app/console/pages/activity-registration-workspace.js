import {request} from '../../core/api.js';
import {leaveReviewActions,leaveStatus,canReviewLeave} from './activity-leave-review.js';
import {rosterColumns} from '../roster-columns.js';
import {activityInformationPreview} from './activity-information-preview.js';
import {h} from '../../core/dom.js';
import {button,field,definitionList} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {registrationCapacity} from '../../shared/activity-registration.js';

/** Registration-only workspace. The host supplies fresh scoped detail and mutations. */
export function activityRegistrationWorkspace({event,data,actionsNode,decide,decideLeave,close,reload,editInformation,loadInformation,loadMailStatuses,onChanged=()=>{}}){
 let snapshot=data,busy=false,disposed=false,uncertain=false,liveEdit=null,mailSequence=0;let mailStatuses=new Map();
 const selected=new Set(),records=h('tbody'),summary=h('span',{class:'t-caption',role:'status'});
 const root=h('div',{class:'activity-registration-workspace'}),content=h('div',{class:'activity-registration-content'});
 let activePosition='',batchMode=false;
 const columns=rosterColumns({columns:['序号','选择','姓名','学号','部门','校区','岗位与时间','报名状态','操作'],key:'registration-'+event._id});
 const tableHead=h('tr'),batchCount=h('span',{class:'t-caption','aria-live':'polite'});
 const positionTabs=h('div',{class:'activity-registration-positions',role:'tablist','aria-label':'活动岗位'});
 function positions(){return snapshot.events.filter(e=>{try{return JSON.parse(e['报名页配置']||'{}').bookingMode!=='grouped';}catch{return false;}});}
 const positionRows=()=>snapshot.registrations.filter(r=>parent(r)?.['活动ID']===activePosition);
 function switchPosition(id){if(busy)return;activePosition=id;selected.clear();render();}

 const status=field({label:'报名状态',options:[{value:'',label:'全部状态'},{value:'待筛选',label:'待判定'},{value:'已确认',label:'报名成功'},{value:'未入选',label:'报名失败'},{value:'已请假',label:'已请假'},{value:'leave-pending',label:'请假待审批'}]});
 const current=()=>snapshot.events.find(e=>e._id===event._id)||event;
 const manager=()=>current().approvalAccess?.canManageRegistration===true&&current()['状态']==='报名中';
 const parent=r=>{const matches=snapshot.events.filter(e=>{let c;try{c=JSON.parse(e['报名页配置']||'{}');}catch{return false;}return e['活动ID']===r['活动ID']||(Array.isArray(c.sourceActivityIds)?c.sourceActivityIds:[]).includes(r['活动ID']);});return matches.length===1?matches[0]:null;};
 const eligible=r=>manager()&&parent(r)?.['活动ID']===r['活动ID']&&parent(r)?.approvalAccess?.canManageRegistration===true&&parent(r)['状态']==='报名中'&&r['报名状态']==='待筛选'&&r['请假状态']!=='待审批';
 const visible=()=>positionRows().filter(r=>(!status.control.value||(status.control.value==='leave-pending'?r['请假状态']==='待审批':status.control.value==='已确认'?['已确认','已签到'].includes(r['报名状态']):r['报名状态']===status.control.value)));
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
  summary.textContent=`报名 ${all.length} 人 · 成功 ${confirmed} 人 · 待判定 ${pending} 人${full.length?' · '+'报名中 · 报名已满':''}`;
  records.replaceChildren(...rows.map((r,index)=>{
   const e=parent(r),check=h('input',{type:'checkbox','aria-label':`选择${r['姓名']||'报名人'}`,checked:selected.has(r._id),disabled:busy||uncertain||!eligible(r),on:{change:ev=>{if(ev.target.checked)selected.add(r._id);else selected.delete(r._id);render();}}});
   const state=r['请假状态']==='待审批'||r['请假状态']==='已批准'?leaveStatus(r):r['报名状态']==='待筛选'?'待判定':r['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(r['报名状态'])?'报名成功':r['报名状态'];
   const decision=h('div',{class:'row-2'},h('span',{text:state})),actions=h('div',{class:'row-2 row-wrap'});
   if(r['请假状态']&&r['请假原因'])decision.append(h('small',{class:'t-caption',text:r['请假原因']}));
   if(r['请假状态']==='已驳回')decision.append(h('small',{class:'t-caption',text:'请假已驳回'}));
   const mail=mailStatuses.get(r._id);if(mail){decision.append(h('small',{class:'t-caption',text:({sent:'已发送',failed:'发送失败',not_sent:'发送中',unknown:'发送结果待确认'})[mail.status]||'发送结果待确认'}));if(['failed','unknown'].includes(mail.status))decision.append(button({label:'查看详情',size:'sm',onClick:()=>openModal({title:'邮件发送详情',body:h('p',{text:mail.reason||(mail.status==='failed'?'本次发送未完成，请核对邮箱后重试；报名处理结果已保存。':'未收到明确发送回执，邮件可能已发出，请先核对，避免重复发送。')}),footer:[]})}));}
   if(r['报名状态']==='未入选'&&r['处理说明'])decision.append(h('small',{class:'t-caption',text:r['处理说明']}));
   const leave=leaveReviewActions(r,{enabled:manager()&&canReviewLeave(e||current())&&!busy&&!uncertain,decide:decideLeave,refresh:fresh});if(leave)actions.append(leave);
   if(!batchMode&&eligible(r))for(const [kind,label] of [['confirm','报名成功'],['reject','报名失败']]){const b=button({label,size:'sm',onClick:()=>submit([r],kind)});locked(b,busy||uncertain);actions.append(b);}
   return h('tr',{},h('td',{'data-roster-column':'序号',text:String(index+1)}),...(batchMode?[h('td',{'data-roster-column':'选择'},check)]:[]),...['姓名','学号','部门','校区'].map(key=>h('td',{'data-roster-column':key,text:r[key]||(key==='部门'?(snapshot.participants||[]).find(p=>p.accountId===r['账号ID'])?.organizationDepartment:'')||'—'})),h('td',{'data-roster-column':'岗位与时间',text:[e?.['岗位']||r['岗位'],r['报名日期']||e?.['报名日期'],r['报名时段']||e?.['报名时段']].filter(Boolean).join(' · ')||'—'}),h('td',{'data-roster-column':'报名状态'},decision),h('td',{'data-roster-column':'操作'},actions));
  }));
  if(!rows.length)records.append(h('tr',{},h('td',{colspan:batchMode?9:8,'data-roster-group':'true',text:'暂无符合条件的报名'})));
  const choices=rows.filter(eligible),allChecked=choices.length>0&&choices.every(row=>selected.has(row._id));
  const allCheck=h('input',{type:'checkbox','aria-label':'选择本页报名',checked:allChecked,disabled:busy||uncertain||!choices.length,on:{change:ev=>{for(const row of choices)if(ev.target.checked)selected.add(row._id);else selected.delete(row._id);render();}}});
  allCheck.indeterminate=!allChecked&&choices.some(row=>selected.has(row._id));
  tableHead.replaceChildren(h('th',{scope:'col','data-roster-column':'序号',text:'序号'}),...(batchMode?[h('th',{scope:'col','data-roster-column':'选择'},allCheck)]:[]),...['姓名','学号','部门','校区','岗位与时间','报名状态','操作'].map(text=>h('th',{scope:'col','data-roster-column':text,text})));
  columns.apply(tableHead.closest('table'));
  locked(renotify,busy||uncertain||!manager());
  batchToggle.textContent=batchMode?'退出批量操作':'批量操作';locked(batchToggle,busy||uncertain||!manager());success.hidden=!batchMode;failure.hidden=!batchMode;batchCount.hidden=!batchMode;batchCount.textContent=`已选择 ${selected.size} 人`;
  locked(success,busy||uncertain||!manager()||!selected.size);locked(failure,busy||uncertain||!manager()||!selected.size);locked(cutoff,busy||uncertain||!manager());locked(edit,busy||uncertain||(current().approvalAccess?.canEditInformation??current().approvalAccess?.canPublish)!==true||!editInformation);
 }
 async function readMailStatuses(){
  if(!loadMailStatuses)return;const sequence=++mailSequence;
  const events=snapshot.events.filter(e=>snapshot.registrations.some(r=>r['活动ID']===e['活动ID']&&['已确认','已签到','未入选'].includes(r['报名状态'])));
  try{const rows=await loadMailStatuses(events);if(disposed||sequence!==mailSequence)return;mailStatuses=new Map(rows.map(row=>[row.id,row]));render();}catch{/* A failed read does not prove a message was sent or failed. */}
 }
 async function fresh(){snapshot=await reload();if(disposed)return;selected.clear();render();onChanged(snapshot);void readMailStatuses();}

 async function commit(rows,kind,reason=''){
  if(busy||uncertain||disposed)return false;
  const matches=row=>row&&(kind==='confirm'?['已确认','已签到'].includes(row['报名状态']):row['报名状态']==='未入选'&&(row['处理说明']||'')===reason);
  const currentRows=rows.map(row=>snapshot.registrations.find(next=>next._id===row._id));
  if(currentRows.some(row=>!matches(row)&&(!row||!eligible(row)))){notify.warning('名单状态已变化，请刷新核对');return false;}
  const pending=currentRows.filter(row=>!matches(row));busy=true;render();
  try{
   for(const e of snapshot.events){const ids=pending.filter(r=>r['活动ID']===e['活动ID']).map(r=>r._id);if(ids.length)await decide(e,ids,kind,reason);}
   await fresh();notify.success('报名结果已保存，通知已进入发送流程');return true;
  }catch(error){uncertain=true;reportError(error,'请刷新核对已保存结果后再操作');try{await fresh();uncertain=false;if(rows.every(row=>matches(snapshot.registrations.find(next=>next._id===row._id))))return true;}catch{/* Keep writes blocked until an authoritative refresh succeeds. */}return false;}
  finally{busy=false;if(!disposed)render();}
 }

 async function submit(rows,kind){
  rows=rows.filter(eligible);if(!rows.length||busy||uncertain)return;
  if(rows.length>100){notify.warning('每次最多处理100人');return;}
  if(kind==='confirm'){if(await confirmAction({title:`确认 ${rows.length} 人报名成功？`,description:'确认后发送成功邮件。',confirmLabel:'确认成功并通知'}))await commit(rows,kind);return;}
  const reason=field({label:'失败原因',value:'很遗憾的通知您，您报名的活动已满',multiline:true,required:true,maxlength:500});let dialog,saving=false;
  const check=button({label:'核对名单',onClick:async()=>{if(saving)return;saving=true;busy=true;reason.control.disabled=true;render();try{await fresh();uncertain=false;}catch(error){reportError(error,'名单仍待核对，填写原因已保留');}finally{saving=false;busy=false;reason.control.disabled=false;check.hidden=!uncertain;confirm.disabled=uncertain;if(!disposed)render();}}});check.hidden=true;
  const confirm=button({label:'确认失败并通知',variant:'primary',onClick:async()=>{if(saving||uncertain||!reason.control.reportValidity()||!reason.control.value.trim())return;saving=true;reason.control.disabled=true;const ok=await commit(rows,kind,reason.control.value.trim());saving=false;reason.control.disabled=false;check.hidden=!uncertain;confirm.disabled=uncertain;if(ok)await dialog.close();}});
  dialog=openModal({title:'报名失败',body:reason,footer:[button({label:'取消',onClick:()=>dialog.close()}),check,confirm]});
  dialog.setCloseGuard(()=>!saving);
 }
 const success=button({label:'批量报名成功',onClick:()=>submit(snapshot.registrations.filter(r=>selected.has(r._id)),'confirm')});
 const failure=button({label:'批量报名失败',onClick:()=>submit(snapshot.registrations.filter(r=>selected.has(r._id)),'reject')});
 const cutoff=button({label:'报名截止',variant:'primary',onClick:async()=>{
  if(busy||uncertain||!manager())return;
  if(snapshot.registrations.some(r=>r['请假状态']==='待审批'||!['已确认','已签到','未入选','已请假'].includes(r['报名状态']))){openModal({title:'暂不能截止报名',body:h('p',{text:'请先完成所有有效报名的成功／失败判定，并处理待审批请假。'}),footer:[]});return;}
  if(!await confirmAction({title:'截止报名？',description:'截止后进入进行中。',confirmLabel:'确认截止'}))return;
  busy=true;render();try{await close();await fresh();}catch(error){reportError(error,'截止结果请刷新核对');}finally{busy=false;if(!disposed)render();}
 }});
 const view=button({label:'活动信息查看',onClick:async()=>{
  try{if(loadInformation){const data=await loadInformation();if(!disposed)openModal({title:'活动信息',width:1100,body:activityInformationPreview(data),footer:[]});}
  else openModal({title:'活动信息',body:definitionList([['活动名称',current()['活动名称']],['日期',current()['报名日期']],['时段',current()['报名时段']],['地点',current()['地点']],['工作内容',current()['工作内容']],['通知',current()['通知草稿']]]),footer:[]});}catch(error){reportError(error,'活动信息加载失败');}
 }});
 const edit=button({label:'活动信息修改',onClick:async()=>{if(busy||uncertain||!editInformation||(current().approvalAccess?.canEditInformation??current().approvalAccess?.canPublish)!==true)return;busy=true;render();try{liveEdit=await editInformation(()=>fresh());}catch(error){reportError(error,'活动信息加载失败');}finally{busy=false;if(!disposed)render();}}});
 const renotify=button({label:'再次通知',onClick:async()=>{
  if(busy||uncertain||!manager())return;
  const rows=visible().filter(row=>['已确认','已签到','未入选'].includes(row['报名状态'])&&row['请假状态']!=='待审批');
  if(!rows.length){notify.warning('当前筛选结果没有可通知的已处理报名');return;}
  busy=true;render();const batches=[];let items=[];
  try{
   for(const e of snapshot.events){const group=rows.filter(row=>row['活动ID']===e['活动ID']);for(let i=0;i<group.length;i+=10){const ids=group.slice(i,i+10).map(row=>row._id),url=`/api/volunteer/workflow/events/${encodeURIComponent(e._id)}/notify-results`;const result=await request(url,{method:'POST',body:{preview:true,ids}});items.push(...result.items);batches.push({url,ids});}}
   const body=h('div',{class:'stack-3'},h('p',{text:`本次 ${items.length} 人，可发送 ${items.filter(item=>!item.reason).length} 人；需核对 ${items.filter(item=>item.reason).length} 人。只通知当前岗位和筛选结果，不改变报名结果。`}));
   const list=h('div',{class:'stack-3'},...items.map(item=>h('section',{class:'panel'},h('div',{class:'panel__body stack-2'},h('strong',{text:item.name}),h('p',{class:'t-caption',text:item.reason||item.email}),h('pre',{class:'mail-template-preview',text:item.information})))));body.append(list);
   let dialog,sending=false;const requestId=crypto.randomUUID();
   const send=button({label:'确认再次通知',variant:'primary',onClick:async()=>{if(sending)return;sending=true;send.disabled=true;const results=[];try{for(const batch of batches){const response=await request(batch.url,{method:'POST',body:{repeat:true,requestId,ids:batch.ids}});results.push(...response.results);}list.replaceChildren(...results.map(result=>h('p',{text:`${items.find(item=>item.id===result.id)?.name||'同学'}：${result.status==='sent'?'已发送':result.status==='failed'?'发送失败':'发送结果待确认'}${result.reason?' · '+result.reason:''}`})));send.textContent='本次通知已处理';await readMailStatuses();}catch(error){body.append(h('p',{role:'alert',text:(error.message||'通知结果待核对')+'；本次批次已保留，请勿重新建立通知批次重复发送。'}));}finally{sending=false;}}});
   send.disabled=items.some(item=>item.reason);dialog=openModal({title:'再次通知 · 收件核验',width:860,body,footer:[button({label:'关闭',onClick:()=>dialog.close()}),send]});dialog.setCloseGuard(()=>!sending);
  }catch(error){reportError(error,'收件核验未完成，没有发送邮件');}finally{busy=false;render();}
 }});
 const batchToggle=button({label:'批量操作',onClick:()=>{if(busy||uncertain||!manager())return;batchMode=!batchMode;selected.clear();render();}});
 for(const control of [status.control])control.addEventListener('change',()=>{selected.clear();render();});
 content.append(positionTabs,h('div',{class:'activity-registration-filters'},status,summary),h('div',{class:'activity-registration-batch'},batchToggle,batchCount,success,failure,renotify,columns.control),h('div',{class:'activity-registration-table'},h('table',{},h('thead',{},tableHead),records)));
 root.append(h('div',{class:'activity-draft-toolbar'},view,edit,cutoff,actionsNode),h('p',{class:'t-caption',text:'如需修改入群信息、注意事项等通知内容，请点击右上角“通知信息编辑”。修改仅影响后续发送的邮件，已发送或已进入发送队列的邮件保持原内容。'}),content);render();void readMailStatuses();
 return {node:root,dispose:()=>{disposed=true;mailSequence++;liveEdit?.dispose();},hasUnsaved:()=>liveEdit?.hasUnsaved()||false,isSaving:()=>busy||liveEdit?.isSaving()||false};
}
