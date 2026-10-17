import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {hoursReadiness,hoursLocked,supportsHoursSubmission} from '../../shared/hours-submission.js';

/** Whole-sheet state is independent of individual ledger approvals. */
export function hoursSubmissionPanel({event,registrations,ledger,canReview,onSaved,hasUnsaved=()=>false}){
 if(!supportsHoursSubmission(event))return null;
 const state=event.hoursSubmission||{revision:0,phase:'draft',absences:{}},locked=hoursLocked(event),ended=event['状态']==='已结束';
 const ready=hoursReadiness(registrations,ledger,state),root=`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}`;
 const node=h('section',{class:'hours-submission-panel panel stack-3','aria-label':'整份时长表'},h('h3',{class:'t-h3',text:'时长表提交'}),
  h('p',{class:'t-secondary',text:ended?'活动已结束，时长表只读。':locked?'已提交审核，负责人暂时不能修改。':`还有 ${ready.pending.length} 人未处理 · 已处理 ${ready.complete} 人（含缺席 ${ready.absent.length} 人）`}));
 if(state.phase==='returned')node.append(notice(`审核人已退回：${state.returnReason}`,{tone:'warning'}));
 let busy=false;
 async function save(action,body){
  if(busy)return false;
  if(hasUnsaved()){notify.warning('请先保存页面中正在编辑的时长');return false;}
  busy=true;node.inert=true;
  try{await request(`${root}/${action}`,{method:'POST',body:{revision:state.revision,...body}});await onSaved();return true;}
  catch(error){reportError(error,'操作未完成，请刷新核对时长表状态');return false;}
  finally{busy=false;node.inert=false;}
 }
 function reasonDrawer({title,action,extra={}}){
  const reason=field({label:title==='退回时长表'?'退回原因':'缺席说明',multiline:true,required:true,maxlength:500});
  let drawer,saving=false,done=false;
  const control=button({label:'确认',variant:'primary',onClick:async()=>{
   if(saving||!reason.control.reportValidity())return;saving=true;control.disabled=true;
   try{if(await save(action,{...extra,reason:reason.control.value})){done=true;saving=false;await drawer.close();}}finally{saving=false;control.disabled=false;}
  }});
  drawer=openDrawer({title,width:560,body:reason,footer:[button({label:'取消',onClick:()=>drawer.close()}),control],beforeClose:async()=>!saving&&(done||!reason.control.value||await confirmAction({title:'放弃未保存的说明？',confirmLabel:'放弃修改'}))});
 }
 if(!ended&&!locked){
  const choices=ready.required.filter(row=>row['报名状态']!=='已签到'&&row['请假状态']!=='待审批'&&!ledger.some(entry=>entry['报名行ID']===row._id));
  if(choices.length)node.append(h('details',{},h('summary',{text:'登记或取消缺席'}),h('div',{class:'stack-2'},...choices.map(row=>h('div',{class:'row-between row-wrap'},h('span',{text:`${row['姓名']} · ${row['学号']}${state.absences?.[row._id]?` · 缺席：${state.absences[row._id].reason}`:''}`}),button({label:state.absences?.[row._id]?'取消缺席':'标记缺席',size:'sm',onClick:()=>state.absences?.[row._id]?save('hours-absence',{registrationId:row._id,reason:null}):reasonDrawer({title:`标记 ${row['姓名']} 缺席`,action:'hours-absence',extra:{registrationId:row._id}})}))))));
  const submit=button({label:'提交整份时长表',variant:'primary',onClick:async()=>{
   if(await confirmAction({title:'提交整份时长表？',description:`本次处理 ${ready.required.length} 人，其中缺席 ${ready.absent.length} 人。提交后由指定审核人审核，退回后才能修改。`,confirmLabel:'提交时长表'}))await save('submit-hours',{});
  }});submit.disabled=ready.pending.length>0||!['进行中','停点'].includes(event['状态']);node.append(submit);
 }
 if(locked&&!ended&&canReview)node.append(button({label:'退回时长表',onClick:()=>reasonDrawer({title:'退回时长表',action:'return-hours'})}));
 return node;
}
