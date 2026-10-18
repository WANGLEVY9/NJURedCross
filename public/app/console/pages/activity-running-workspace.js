import {h} from '../../core/dom.js';
import {button,field,definitionList,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';
import {runningPositions,runningParticipants,runningHours} from '../../shared/activity-running.js';
import {activityInformationPreview} from './activity-information-preview.js';

/** Read-only running surface until the independent director-review writer is available. */
export function activityRunningWorkspace({event,data,actionsNode,reload,loadInformation,loadAttendance,onChanged=()=>{}}){
 let snapshot=data,active='',busy=false,disposed=false;
 const body=h('tbody'),tabs=h('div',{class:'activity-registration-positions',role:'tablist','aria-label':'活动岗位'}),summary=h('span',{class:'t-caption',role:'status'});
 const filter=field({label:'初审状态',options:[{value:'',label:'全部状态'},{value:'待初审',label:'待初审'},{value:'通过',label:'初审通过'},{value:'不通过',label:'初审不通过'}],onInput:render});
 async function attendance(row){
  try{const detail=await loadAttendance(row._id);if(disposed)return;
   const content=h('div',{class:'stack-3'},definitionList([['姓名',detail.name],['学号',detail.studentId],['提交时间',detail.submittedAt||'未提交'],['签到核验',detail.verified?`已核验 · ${detail.verified.at||''}`:'未核验']]));
   if(detail.hasPhoto)content.append(h('img',{src:`/api/volunteer/workflow/registrations/${encodeURIComponent(row._id)}/photo`,alt:'签到照片',style:'max-width:100%;max-height:60vh;object-fit:contain'}));
   for(const warning of detail.warnings||[])content.append(notice(warning,{tone:'warning'}));
   for(const legacy of detail.legacy||[])content.append(definitionList([['签到时间',legacy.time],['备注',legacy.note],['核对状态',legacy.status]]));
   openModal({title:'签到记录',body:content,width:900,footer:[]});
  }catch(error){reportError(error,'签到记录加载失败');}
 }
 function render(){
  const jobs=runningPositions(snapshot);if(!jobs.some(job=>job['活动ID']===active))active=jobs[0]?.['活动ID']||'';
  tabs.hidden=jobs.length<2;tabs.replaceChildren(...jobs.map((job,index)=>{
   const tab=button({label:job['岗位']||job['活动名称'],onClick:()=>{active=job['活动ID'];render();}});
   tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(active===job['活动ID']));tab.tabIndex=active===job['活动ID']?0:-1;
   tab.addEventListener('keydown',ev=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(ev.key))return;ev.preventDefault();const next=ev.key==='Home'?0:ev.key==='End'?jobs.length-1:(index+(ev.key==='ArrowRight'?1:-1)+jobs.length)%jobs.length;active=jobs[next]['活动ID'];render();tabs.children[next]?.focus();});return tab;
  }));
  const all=runningParticipants(snapshot,active),rows=all.filter(row=>!filter.control.value||row.review===filter.control.value);
  summary.textContent=`参与 ${all.length} 人 · 待初审 ${all.length} 人`;
  body.replaceChildren(...rows.map(({registration:row,entry,review,ambiguous})=>h('tr',{},h('td',{text:row['姓名']}),h('td',{text:row['学号']}),h('td',{text:ambiguous?'记录待核对':runningHours(entry)}),h('td',{},button({label:'查看签到',variant:'ghost',size:'sm',onClick:()=>attendance(row)})),h('td',{text:review}))));
  if(!rows.length)body.append(h('tr',{},h('td',{colspan:5,text:'暂无符合条件的参与记录'})));
 }
 const view=button({label:'活动信息查看',onClick:async()=>{try{const content=await loadInformation();if(!disposed)openModal({title:'活动信息',width:1100,body:activityInformationPreview(content),footer:[]});}catch(error){reportError(error,'活动信息加载失败');}}});
 const edit=button({label:'活动信息修改',disabled:true});
 const upload=button({label:'上传时长表',variant:'primary',disabled:true});
 upload.title='时长表上传暂未开放';
 const refresh=button({label:'刷新名单',onClick:async()=>{if(busy)return;busy=true;refresh.disabled=true;try{const result=await reload();if(disposed)return;snapshot=result;render();onChanged(result);}catch(error){reportError(error,'名单刷新失败');}finally{busy=false;refresh.disabled=false;}}});
 const node=h('div',{class:'activity-registration-workspace activity-running-workspace'},h('div',{class:'activity-draft-toolbar'},view,edit,upload,actionsNode),h('div',{class:'activity-registration-content'},tabs,h('div',{class:'activity-registration-filters'},filter,summary),refresh,h('div',{class:'activity-registration-table'},h('table',{},h('thead',{},h('tr',{},...['姓名','学号','时长（小时）','签到','负责人初审'].map(text=>h('th',{scope:'col',text})))),body))));
 render();return {node,dispose:()=>{disposed=true;},hasUnsaved:()=>false,isSaving:()=>busy};
}
