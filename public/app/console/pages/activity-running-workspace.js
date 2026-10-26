import {leaveReviewActions,leaveStatus,canReviewLeave} from './activity-leave-review.js';
import {h} from '../../core/dom.js';
import {button,field,definitionList,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';
import {runningPositions,runningParticipants,runningHours} from '../../shared/activity-running.js';
import {activityInformationPreview} from './activity-information-preview.js';
import {runningReviewEditor} from './activity-running-editor.js';
import {positionLeaveSummary} from '../../shared/activity-leave-attention.js';
import {leaveAttention,markPositionLeave} from './activity-leave-attention.js';

/** Running roster and independent director review; final presidium approval is a later phase. */
export function activityRunningWorkspace({event,data,reviewState={entries:[],canRecord:false},actionsNode,reload,loadInformation,editInformation,loadAttendance,loadReview,decideLeave,saveReview,importFile,previewReview,submitReview,reopen,onChanged=()=>{}}){
 let snapshot=data,state=reviewState,active='',busy=false,disposed=false,liveEditor=null;
 const leaves=h('section',{class:'stack-3'}),body=h('tbody'),tabs=h('div',{class:'activity-registration-positions',role:'tablist','aria-label':'活动岗位'}),summary=h('span',{class:'t-caption',role:'status'});
 const filter=field({label:'初审状态',options:[{value:'',label:'全部状态'},{value:'待初审',label:'待初审'},{value:'初审通过',label:'初审通过'},{value:'初审不通过',label:'初审不通过'}],onInput:render});
 const attention=leaveAttention({onOpen:id=>{if(busy||!id)return;active=id;render();leaves.tabIndex=-1;leaves.focus({preventScroll:true});leaves.scrollIntoView({block:'nearest'});}});
 async function fresh(){const [next,nextReview]=await Promise.all([reload(),loadReview?loadReview():Promise.resolve(state)]);if(disposed)return;state=nextReview;snapshot=next;render();onChanged(next);return state;}
 function editorRows(only){return runningPositions(snapshot).flatMap(job=>runningParticipants(snapshot,job['活动ID'],state.entries)).filter(row=>!only||row.registration._id===only).map(({registration:row,firstReview})=>{const job=runningPositions(snapshot).find(job=>job['活动ID']===row['活动ID']);return {name:row['姓名'],studentId:row['学号'],position:job?.['岗位']||job?.['活动名称'],date:row['报名日期'],slot:row['报名时段'],item:firstReview||{id:row._id,serviceHours:'',trainingHours:'',travelHours:'',decision:'',reason:'',evidenceChecked:false}};});}
 function openEditor(only,decision){if(!state.canRecord||busy||!saveReview)return;liveEditor=runningReviewEditor({rows:editorRows(only).map(row=>decision===undefined?row:{...row,item:{...row.item,decision}}),token:state.token,importFile,preview:previewReview,submit:submitReview,save:saveReview,onSaved:fresh,onClosed:()=>{if(!disposed)render();},single:Boolean(only)});}
 async function attendance(row){
  try{const detail=await loadAttendance(row._id);if(disposed)return;
   const content=h('div',{class:'stack-3'},definitionList([['姓名',detail.name],['学号',detail.studentId],['提交时间',detail.submittedAt||'未提交'],['签到核验',detail.verified?`已核验 · ${detail.verified.at||''}`:'未核验']]));
   if(detail.hasPhoto)content.append(h('img',{src:`/api/volunteer/workflow/registrations/${encodeURIComponent(row._id)}/photo`,alt:'签到照片',class:'activity-running-evidence',on:{error:ev=>ev.target.replaceWith(notice('签到照片暂时无法加载，请稍后重试',{tone:'warning'}))}}));
   for(const warning of detail.warnings||[])content.append(notice(warning,{tone:'warning'}));
   for(const legacy of detail.legacy||[]){content.append(definitionList([['签到时间',legacy.time],['备注',legacy.note],['核对状态',legacy.status]]));for(const [index,url]of(legacy.photos||[]).entries())content.append(h('a',{class:'btn btn--secondary',href:url,target:'_blank',rel:'noopener noreferrer',text:`原表签到照片 ${index+1}`,data:{native:true}}));}
   openModal({title:'签到记录',body:content,width:900,footer:[]});
  }catch(error){reportError(error,'签到记录加载失败');}
 }
 function render(){
  const jobs=runningPositions(snapshot);if(!jobs.some(job=>job['活动ID']===active))active=jobs[0]?.['活动ID']||'';
  const leaveSummary=positionLeaveSummary(snapshot);attention.update(leaveSummary,active,{disabled:busy});
  tabs.hidden=jobs.length<2&&![...leaveSummary.values()].some(value=>value.pending);tabs.replaceChildren(...jobs.map((job,index)=>{
   const tab=button({label:job['岗位']||job['活动名称'],onClick:()=>{active=job['活动ID'];render();}});
   tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(active===job['活动ID']));tab.tabIndex=active===job['活动ID']?0:-1;
   markPositionLeave(tab,leaveSummary.get(job['活动ID'])?.pending||0);
   tab.addEventListener('keydown',ev=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(ev.key))return;ev.preventDefault();const next=ev.key==='Home'?0:ev.key==='End'?jobs.length-1:(index+(ev.key==='ArrowRight'?1:-1)+jobs.length)%jobs.length;active=jobs[next]['活动ID'];render();tabs.children[next]?.focus();});return tab;
  }));
  const all=runningParticipants(snapshot,active,state.entries),rows=all.filter(row=>!filter.control.value||row.review===filter.control.value);
  summary.textContent=`参与 ${all.length} 人 · 待初审 ${all.filter(row=>row.review==='待初审').length} 人`;
  const leaveRows=leaveSummary.get(active)?.rows||[];
  leaves.hidden=!leaveRows.length;leaves.replaceChildren(h('h3',{text:'请假申请与处理记录'}),h('div',{class:'activity-registration-table'},h('table',{},h('thead',{},h('tr',{},...['姓名','学号','请假状态','请假原因','操作'].map(text=>h('th',{scope:'col',text})))),h('tbody',{},...leaveRows.map(row=>h('tr',{},h('td',{text:row['姓名']}),h('td',{text:row['学号']}),h('td',{text:leaveStatus(row)}),h('td',{text:row['请假原因']}),h('td',{},leaveReviewActions(row,{enabled:event.approvalAccess?.canManageRegistration===true&&canReviewLeave(event)&&!busy,decide:decideLeave,refresh:fresh}))))))));
  body.replaceChildren(...rows.map(({registration:row,entry,firstReview,review,ambiguous})=>{
   const evidence=h('div',{class:'activity-running-evidence-actions'});
   if(row['签到照片ID']||row['签到行ID'])evidence.append(button({label:'查看签到',variant:'ghost',size:'sm',onClick:()=>attendance(row)}));
   if(firstReview?.attendanceUrl)evidence.append(h('a',{href:firstReview.attendanceUrl,target:'_blank',rel:'noopener noreferrer',text:'签到链接',data:{native:true}}));
   if(!evidence.childNodes.length)evidence.append(h('span',{class:'t-caption',text:'未提供'}));
   if(state.canRecord)evidence.append(button({label:'补充签到',variant:'ghost',size:'sm',onClick:()=>openEditor(row._id)}));
   const select=h('select',{class:'input','aria-label':`${row['姓名']} 负责人初审`,disabled:busy||!state.canRecord,on:{change:ev=>openEditor(row._id,ev.target.value)}},...['','pass','fail'].map((value,index)=>h('option',{value,text:['待初审','审核通过','不通过'][index]})));select.value=firstReview?.decision||'';
   return h('tr',{},h('td',{text:row['姓名']}),h('td',{text:row['学号']}),h('td',{text:firstReview?`服务 ${firstReview.serviceHours} · 培训 ${firstReview.trainingHours} · 交通 ${firstReview.travelHours}`:ambiguous?'记录待核对':runningHours(entry)}),h('td',{},evidence),h('td',{},select,firstReview?.reason?h('small',{class:'t-caption',text:firstReview.reason}):null));
  }));
  if(!rows.length)body.append(h('tr',{},h('td',{colspan:5,text:'暂无符合条件的参与记录'})));
  edit.disabled=busy||!editInformation||snapshot.events.find(row=>row._id===event._id)?.approvalAccess?.canEditInformation!==true;upload.disabled=busy||!state.canRecord||!saveReview;backToRegistration.disabled=busy||!reopen||state.status==='submitted'||state.entries?.length>0;
 }
 const view=button({label:'活动信息查看',onClick:async()=>{try{const content=await loadInformation();if(!disposed)openModal({title:'活动信息',width:1100,body:activityInformationPreview(content),footer:[]});}catch(error){reportError(error,'活动信息加载失败');}}});
 const edit=button({label:'活动信息修改',disabled:true,onClick:async()=>{if(busy||!editInformation||edit.disabled)return;try{liveEditor=await editInformation(fresh);}catch(error){reportError(error,'活动信息加载失败');}}});
 const upload=button({label:'上传时长表',variant:'primary',onClick:()=>openEditor()});
 const backToRegistration=button({label:'回退报名中',onClick:()=>{
  if(busy||!reopen)return;const reason=field({label:'回退原因',required:true,multiline:true,maxlength:500});let dialog,saving=false;
  const confirm=button({label:'确认回退',onClick:async()=>{if(saving||!reason.control.reportValidity()||!reason.control.value.trim())return;saving=true;confirm.disabled=true;try{await reopen(reason.control.value.trim());saving=false;await dialog.close();await fresh();}catch(error){reportError(error,'回退未完成，请刷新核对');}finally{saving=false;confirm.disabled=false;}}});
  dialog=openModal({title:'回退到报名中',body:reason,footer:[button({label:'取消',onClick:()=>dialog.close()}),confirm]});dialog.setCloseGuard(()=>!saving);
 }});
 if(event.approvalAccess?.canManageRegistration===true)actionsNode?.querySelector('.activity-v2-more__menu')?.append(backToRegistration);
 const node=h('div',{class:'activity-registration-workspace activity-running-workspace'},h('div',{class:'activity-draft-toolbar'},view,edit,upload,actionsNode),h('div',{class:'activity-registration-content'},attention.node,tabs,leaves,h('div',{class:'activity-registration-filters'},filter,summary),h('div',{class:'activity-registration-table'},h('table',{},h('thead',{},h('tr',{},...['姓名','学号','时长（小时）','签到','负责人初审'].map(text=>h('th',{scope:'col',text})))),body))));
 render();return {node,dispose:()=>{disposed=true;liveEditor?.dispose();},hasUnsaved:()=>liveEditor?.hasUnsaved()||false,isSaving:()=>busy||liveEditor?.isSaving()||false,applyReview(next){if(disposed||busy||liveEditor||next===undefined)return;state=next;render();}};
}
