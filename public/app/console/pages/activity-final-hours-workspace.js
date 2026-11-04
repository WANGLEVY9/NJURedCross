import {h} from '../../core/dom.js';
import {requestBlob} from '../../core/api.js';
import {button,field,definitionList,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {FINAL_HOURS_COLUMNS,FINAL_HOURS_INSTRUCTIONS} from '../../shared/activity-final-hours.js';
import {activityInformationPreview} from './activity-information-preview.js';
import {hoursBatchReview} from './activity-hours-batch.js';
import {manualHoursDialog} from './manual-hours-dialog.js';
const valid=row=>row.decision==='pass'&&row.serviceHours+row.trainingHours+row.travelHours>0;
export function activityFinalHoursWorkspace({adminEditInformation,initial,load,save,addParticipant,exportFile,downloadUrl,retryMail,loadInformation,actionsNode,onChanged=()=>{}}){
 let state=initial,busy=false,disposed=false,dirty=false,editing=null,previewDialog=null,previewToken=null;
 const content=h('div',{class:'activity-registration-content'}),toolbar=h('div',{class:'activity-draft-toolbar'});
 const ended=()=>state.status==='exported';
 const batch=hoursBatchReview({title:'批量时长终审',description:'只修改所选记录的终审结果，保留各人的实际时长、地点与工作明细。完成后请预览并导出最终表。',getToken:()=>state.token,itemOf:row=>({id:row.id}),save,onSaved:fresh,onSaving:value=>{busy=value;if(!disposed)render();}});
 async function fresh(){const next=await load();if(disposed)return;state=next;render();onChanged(next);return next;}
 function table(rows,controls=false,instructions=false){
  const body=h('tbody');for(const [index,row]of rows.entries())body.append(h('tr',{},...FINAL_HOURS_COLUMNS.map(([key])=>key==='name'&&controls?h('td',{},h('div',{class:'activity-hours-person'},batch.selection(row),h('span',{text:row.name}))):h('td',{text:key==='index'?String(index+1):String(row[key]??'')})),...(controls?[h('td',{},h('span',{text:row.decision==='pass'?'通过':'未通过'}),state.canEdit?button({label:'修改明细',size:'sm',onClick:()=>editRow(row)}):null)]:[])));
  if(!rows.length)body.append(h('tr',{},h('td',{colspan:controls?12:11,text:'暂无符合条件的时长'})));
  const compact={index:'序号',trainingHours:'培训时长/小时',travelHours:'交通时长/小时',serviceHours:'服务时长/小时'};
  return h('div',{class:'activity-registration-table activity-final-hours-table'},h('table',{},h('caption',{text:'分工时长表'}),h('colgroup',{},...(controls?[4,7,8,10,10,15,6,6,6,12,6,10]:[4,7,9,10,11,18,7,7,7,14,6]).map(width=>h('col',{width:`${width}%`}))),h('thead',{},h('tr',{},...FINAL_HOURS_COLUMNS.map(([key,text])=>h('th',{scope:'col',title:text,text:instructions?text:compact[key]||text})),...(controls?[h('th',{scope:'col',text:'审核'})]:[])),instructions?h('tr',{class:'activity-final-hours-instructions'},...FINAL_HOURS_INSTRUCTIONS.map(text=>h('td',{text})),...(controls?[h('td')]:[])):null),body));
 }
 function preview(){
  const rows=state.rows.filter(valid),rejected=state.rows.filter(row=>row.decision!=='pass');
  const body=h('div',{class:'stack-3 activity-final-hours-full-preview'},table(rows,false,true),rejected.length?h('details',{},h('summary',{text:`未通过记录 ${rejected.length} 人`}),...rejected.map(row=>h('p',{text:`${row.name} · ${row.studentId} · ${row.reason||'未通过'}`}))):null);
  const dialog=openModal({title:'完整分工时长表',width:1600,body,footer:[exportButton],onClose:()=>{previewDialog=null;previewToken=null;}});
  previewDialog=dialog;previewToken=state.token;exportButton.disabled=busy||!state.canEdit;dialog.setCloseGuard(()=>disposed||!busy);
  dialog.surface.classList.add('activity-final-hours-modal');
 }
 async function editRow(row){
  if(busy||!state.canEdit||ended())return;
  const fields={};for(const [key,label]of [['serviceHours','服务时长'],['trainingHours','培训时长（整数）'],['travelHours','交通时长'],['location','具体工作地点'],['dates','正式工作日期'],['work','工作内容'],['remark','备注'],['reason','未通过原因']])fields[key]=field({label,value:String(row[key]??''),...(key.endsWith('Hours')?{type:'number',min:0,max:100000,step:key==='trainingHours'?'1':'any'}:{multiline:true,maxlength:1000})});
  fields.decision=field({label:'审核结果',value:row.decision,options:[{value:'pass',label:'通过'},{value:'fail',label:'未通过'}]});
  const check=h('input',{type:'checkbox',checked:row.evidenceChecked,'aria-label':'已核对有效签到依据'}),feedback=h('div',{role:'status'});let dialog,saving=false,uncertain=false;
  const values=()=>({id:row.id,...Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.control.value])),evidenceChecked:check.checked});
  const lock=()=>{for(const field of Object.values(fields))field.control.disabled=saving;check.disabled=saving;confirm.disabled=saving||uncertain;reconcile.hidden=!uncertain;reconcile.disabled=saving;};
  const reconcile=button({label:'核对最新版本',onClick:async()=>{if(saving)return;saving=true;lock();try{await fresh();uncertain=false;feedback.replaceChildren(notice('已载入最新版本，请核对填写内容后保存',{tone:'neutral'}));}catch(error){reportError(error,'时长表仍待核对');}finally{saving=false;lock();}}});
  const confirm=button({label:'保存明细',variant:'primary',onClick:async()=>{
   if(saving||uncertain)return;saving=true;busy=true;lock();
   try{await save({token:state.token,items:[values()]});await fresh();dirty=false;saving=false;await dialog.close();notify.success('明细已保存');}
   catch(error){uncertain=![400,403].includes(error.status);reportError(error,'请核对保存结果后重试');feedback.replaceChildren(notice('填写内容已保留',{tone:'warning'}));}
   finally{saving=false;busy=false;lock();if(!disposed)render();}
  }});
  const form=h('div',{class:'stack-3'},definitionList([['姓名',row.name],['学号',row.studentId],['院系',row.department],...(row.memberIds||[]).length>1?[['参与记录',`${row.memberIds.length} 个场次已合并 · 时长按合计填写`]]:[]]),feedback,h('div',{class:'activity-draft-grid'},...Object.values(fields)),h('label',{},check,' 已核对有效签到依据'));
  form.addEventListener('input',()=>{dirty=true;});form.addEventListener('change',()=>{dirty=true;});
  dialog=openModal({title:'修改时长明细',width:1000,body:form,footer:[button({label:'取消',onClick:()=>dialog.close()}),reconcile,confirm],onClose:()=>{dirty=false;editing=null;}});editing=dialog;
  dialog.setCloseGuard(async()=>disposed||!saving&&(!dirty||await confirmAction({title:'放弃未保存的时长修改？',confirmLabel:'放弃修改'})));lock();
 }
 const view=button({label:'活动信息查看',onClick:async()=>{try{const data=await loadInformation();if(!disposed)openModal({title:'活动信息',width:1100,body:activityInformationPreview(data),footer:[]});}catch(error){reportError(error,'活动信息加载失败');}}});
 const infoEdit=button({label:'活动信息修改',disabled:!adminEditInformation,onClick:()=>adminEditInformation?.()});
 const previewButton=button({label:'预览并导出',onClick:preview});
 async function loadLatest(){const next=await load({fresh:true});if(disposed)return null;state=next;render();return next;}
 const addPerson=button({label:'手动添加人员',onClick:async()=>{
  if(busy||!state.canEdit||ended()||!addParticipant)return;
  busy=true;render();
  try{
   const latest=await loadLatest();if(!latest||!latest.canEdit||ended())return;
   editing=manualHoursDialog({key:downloadUrl,positions:state.positions||[],token:state.token,resume:state.pendingRequests?.[0],integerTraining:true,submit:addParticipant,loadLatest,onSaving:value=>{busy=value;if(!disposed)render();},onSaved:fresh,onClosed:()=>{editing=null;}});
  }catch(error){if(!disposed)reportError(error,'最新时长表读取失败，请重试；补录草稿仍保留');}
  finally{busy=false;if(!disposed)render();}
 }});
 async function download(){
  const {blob,disposition}=await requestBlob(downloadUrl,{method:'GET'});
  let filename='分工时长表.xlsx';const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if(encoded)try{filename=decodeURIComponent(encoded[1]);}catch{/* Keep a readable fallback for malformed headers. */}
  const url=URL.createObjectURL(blob),link=h('a',{href:url,download:filename});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
 }
 const exportButton=button({label:'导出',variant:'primary',onClick:async()=>{
  if(busy||!state.canEdit||ended()||previewToken!==state.token||!await confirmAction({title:'导出最终表并结束活动？',description:'导出后锁定最终表，并向负责人发送附件及录入提醒。',confirmLabel:'导出并结束'}))return;
  busy=true;render();try{await exportFile({token:state.token});state=await load();if(ended()){try{await download();}catch(error){reportError(error,'最终表已归档，下载失败请重试');}busy=false;await previewDialog?.close();}render();onChanged(state);notify.success('最终表已归档，可在已结束页面下载');}
  catch(error){reportError(error,'导出结果请刷新核对');try{await fresh();}catch{/* The download remains available after a successful authoritative refresh. */}}
  finally{busy=false;if(!disposed)render();}
 }});
 const downloadButton=button({label:'下载时长表',href:downloadUrl,variant:'primary'});downloadButton.dataset.native='true';
 downloadButton.addEventListener('click',async event=>{event.preventDefault();if(busy)return;busy=true;try{await download();}catch(error){reportError(error,'下载失败，请重试');}finally{busy=false;}});
 const retry=button({label:'重试负责人邮件',onClick:async()=>{if(busy)return;busy=true;render();try{await retryMail();await fresh();}catch(error){reportError(error,'邮件结果请刷新核对');}finally{busy=false;if(!disposed)render();}}});
 function render(){
  addPerson.disabled=busy||!state.canEdit||!addParticipant||!state.positions?.length;addPerson.hidden=ended();
  toolbar.replaceChildren(view,infoEdit,...(ended()?[downloadButton]:[addPerson,previewButton]),actionsNode);
  exportButton.disabled=busy||!state.canEdit;retry.disabled=busy;
  content.replaceChildren(h('div',{class:'row-between'},h('strong',{text:ended()?'最终时长表':'时长审核'}),h('span',{class:'t-caption',text:`共 ${state.rows.length} 人 · 通过 ${state.rows.filter(valid).length} 人`})));
  const merged=state.rows.filter(row=>(row.memberIds||[]).length>1).length;
  if(merged&&!ended())content.append(h('p',{class:'t-caption',text:`同一学号报了多个场次时按账号合并为一行：三项时长相加，工作地点、日期与内容合并显示（当前 ${merged} 人）。`}));
  if(ended())content.append(notice(({sent:'最终表附件及录入提醒已发送给负责人。',pending:'负责人邮件等待发送，最终表可直接下载。',failed:'负责人邮件暂未发送成功，最终表可直接下载。',unknown:'负责人邮件发送结果待核对，最终表可直接下载。'})[state.mailStatus]||'最终表已归档。',{tone:state.mailStatus==='sent'?'success':'warning'}));
  if(ended()&&['pending','failed'].includes(state.mailStatus))content.append(retry);
  if(ended()&&state.hoursProgress?.length){const rows=state.hoursProgress.filter(row=>row.hours);const posted=rows.filter(row=>row.summarySynced).length;content.append(notice(`时长入账：已写入两张汇总表 ${posted}/${rows.length} 条。个人主页由 NJUTable 自动化更新，网站读取个人主页表显示。`,{tone:posted===rows.length?'info':'warning'}),h('details',{},h('summary',{text:'查看人员入账进度'}),...state.hoursProgress.map(row=>h('p',{class:'t-caption',text:`${row.name} · ${row.studentId} · ${row.label}`}))));}
  if(state.pendingManual)content.append(notice('存在未完成的人员补录，请重新打开“手动添加人员”核对完成后再导出。',{tone:'warning'}));
  batch.update(state.rows,state.canEdit===true&&!ended()&&!busy);
  if(!ended())content.append(batch.node);
  content.append(table(ended()?state.rows.filter(valid):state.rows,!ended()));
 }
 const node=h('div',{class:'activity-registration-workspace activity-final-hours-workspace'},toolbar,content);render();
 return {node,hasUnsaved:()=>dirty||batch.hasUnsaved(),isSaving:()=>busy||batch.isSaving(),dispose:()=>{disposed=true;dirty=false;batch.dispose();void editing?.close();void previewDialog?.close();}};
}
