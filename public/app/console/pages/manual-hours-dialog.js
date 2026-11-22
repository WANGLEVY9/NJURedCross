import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {hoursFields,entryValues} from './hours-fields.js';
import {finalTrainingHours} from '../../shared/activity-final-hours.js';
import {getSessionState} from '../../core/api.js';

/**
 * 补录人员对话框。
 *
 * 身份不再手填：只能从「已注册且启用的平台账号」里检索选择，选中后学号、院系自动带出。
 * 未注册的人没有检索源，也就无法补录——否则会写出一条 `manual:学号` 的台账行，
 * 汇总时既找不到人也无法入账。`searchPeople` 缺省时才退回手填（供无目录环境降级）。
 */
export function manualHoursDialog({key,positions,token,submit,loadLatest,onSaved,resume,integerTraining=false,searchPeople=null,onSaving=()=>{},onClosed=()=>{}}){
 const user=getSessionState().user,storageKey=`manual-hours:${user?.username||user?.accountId||''}:${key}`;let draft;
 try{draft=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{/* Storage is optional. */}
 if(!positions.some(row=>row.id===draft?.eventId))draft=null;
 if(!draft&&resume)draft={...resume,submitted:{...resume,...(token?{token}: {})}};
 const requestId=draft?.requestId||crypto.randomUUID();
 let saving=false,uncertain=!!draft?.submitted,dirty=!!draft,dialog,submitted=draft?.submitted;
 // 只认已注册账号：草稿里没有 accountId 的（历史补录）一律要求重新选择。
 let picked=draft?.accountId?{accountId:draft.accountId,name:draft.name||'',studentId:draft.studentId||'',department:draft.department||''}:null;
 let searchTimer=null;
 const searchInput=h('input',{class:'input',type:'search',autocomplete:'off',placeholder:searchPeople?'输入姓名或学号，从已注册成员中选择':'输入姓名','aria-label':'搜索补录人员',value:picked?`${picked.name}（${picked.studentId}）`:(draft?.name?`${draft.name}（${draft.studentId||''}）`:'')});
 const resultsBox=h('div',{class:'stack-2 hours-supplement-results'});
 const pickedBox=h('div',{class:'t-caption'});
 const email=field({label:'邮箱（可选）',value:draft?.email||'',maxlength:160,type:'email'});
 const manualName=field({label:'姓名',required:true,value:draft?.name||'',maxlength:80});
 const manualStudent=field({label:'学号',required:true,value:draft?.studentId||'',maxlength:32});
 const manualDepartment=field({label:'院系',required:true,value:draft?.department||'',maxlength:120});
 const manualIdentity=h('div',{class:'activity-draft-grid',hidden:Boolean(searchPeople)},manualName.node,manualStudent.node,manualDepartment.node);
 function paintPicked(){
  if(!searchPeople){pickedBox.replaceChildren(h('span',{text:'当前环境未接入人员目录，请手工填写姓名、学号与院系。'}));resultsBox.replaceChildren();return;}
  pickedBox.replaceChildren(h('span',{text:picked?`已选：${picked.name} · ${picked.studentId} · ${picked.department||'院系未填'}`:'只能选择已注册平台的成员；未注册的人搜不到，也就无法补录。'}));
  if(picked)resultsBox.replaceChildren();
 }
 function identityValue(){
  if(searchPeople)return picked;
  return {name:manualName.control.value.trim(),studentId:manualStudent.control.value.trim(),department:manualDepartment.control.value.trim(),email:email.control.value.trim()};
 }
 async function runSearch(){
  if(!searchPeople)return;
  const query=searchInput.value.trim();
  if(query.length<2){resultsBox.replaceChildren();return;}
  resultsBox.replaceChildren(h('p',{class:'t-caption',text:'正在检索…'}));
  try{
   const items=await searchPeople(query);
   if(!Array.isArray(items)||!items.length){
    resultsBox.replaceChildren(h('p',{class:'t-caption',text:'没有匹配的已注册成员。若本人尚未注册平台账号，请先完成注册后再补录。'}));
    return;
   }
   resultsBox.replaceChildren(...items.map(item=>button({label:`${item.name} · ${item.studentId}${item.department?` · ${item.department}`:''}`,size:'sm',variant:'ghost',onClick:()=>{
    picked={accountId:item.accountId,name:item.name,studentId:item.studentId,department:item.department||''};
    searchInput.value=`${picked.name}（${picked.studentId}）`;
    paintPicked();dirty=true;remember();
   }})));
  }catch(error){resultsBox.replaceChildren(h('p',{class:'t-caption',text:error?.message||'检索失败，请稍后重试'}));}
 }
 searchInput.addEventListener('input',()=>{
  if(!searchPeople)return;
  picked=null;paintPicked();dirty=true;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{void runSearch();},250);
 });
 const feedback=h('div',{role:'status'}),detailsHost=h('div');let details;
 const position=field({label:'实际服务班次',required:true,value:draft?.eventId||positions[0]?.id,options:positions.map(row=>({value:row.id,label:row.name})),onInput:()=>resetDetails()});
 const reason=field({label:'补录依据',required:true,multiline:true,maxlength:500,value:draft?.reason||'',hint:'说明实际服务情况及核对依据。'});
 const checked=h('input',{type:'checkbox',checked:!!draft?.evidenceChecked,'aria-label':'已核对实际服务及补录依据'});
 checked.style.accentColor='var(--success, #23834b)';
 function resetDetails(){const event=positions.find(row=>row.id===position.control.value)?.event||{},values=draft?.details||entryValues(null,{报名日期:event['报名日期'],报名时段:event['报名时段']},event);if(integerTraining&&Number.isFinite(Number(values.trainingHours)))values.trainingHours=finalTrainingHours(values.trainingHours);details=hoursFields(values);if(integerTraining)details.node.querySelector('[data-hour-field="trainingHours"] input')?.setAttribute('step','1');draft=null;detailsHost.replaceChildren(details.node);}
 const payload=()=>{
  const identity=identityValue()||{};
  return {requestId,eventId:position.control.value,...(identity.accountId?{accountId:identity.accountId}:{}),
   name:identity.name||'',studentId:identity.studentId||'',department:identity.department||'',email:identity.email||'',
   details:details.values(),reason:reason.control.value.trim(),evidenceChecked:checked.checked,...(token?{token}: {})};
 };
 const remember=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({...payload(),...(submitted?{submitted}: {})}));}catch{/* Preserve the open form even when browser storage is unavailable. */}};
 function lock(){for(const node of body.querySelectorAll('input,select,textarea,button'))node.disabled=saving||uncertain;save.disabled=saving;save.querySelector('span').textContent=uncertain?'核对并重试':'添加人员';cancel.disabled=saving;}
 const save=button({label:'添加人员',variant:'primary',onClick:async()=>{
  if(saving)return;
  const reconciling=Boolean(submitted);
  if(!submitted){
   if(searchPeople&&!picked){feedback.replaceChildren(notice('请先搜索并选择一名已注册成员',{tone:'warning'}));searchInput.focus();return;}
   if(!searchPeople&&!Object.values({manualName,manualStudent,manualDepartment}).every(node=>node.control.reportValidity()))return;
   if(!details.valid()||!reason.control.reportValidity())return;
   if(!checked.checked){feedback.replaceChildren(notice('请先核对实际服务及补录依据',{tone:'warning'}));return;}
   submitted=payload();remember();
  }
  saving=true;onSaving(true);lock();
  try{
   if(reconciling&&loadLatest){
    const latest=await loadLatest();
    if(!latest||latest.status==='exported')throw Object.assign(Error('最终表已归档，不能继续补录，请关闭窗口核对最终名单'),{status:409});
    if(latest.canSupplement!==true&&latest.canRecord!==true&&latest.canEdit!==true)throw Object.assign(Error('当前账号已无补录权限，请关闭窗口核对'),{status:409});
    if(!latest.positions?.some(row=>row.id===submitted.eventId))throw Object.assign(Error('原服务班次已变化，请关闭窗口核对；填写内容已保留'),{status:409});
    if(typeof latest.token!=='string'||!latest.token)throw Error('最新时长表版本未读取完整，请稍后核对重试');
    // Keep the immutable business request and its idempotency identity. Only the
    // separately validated version changes; never replay with a cached token.
    token=latest.token;submitted={...submitted,token};remember();
   }
   await submit(submitted);try{sessionStorage.removeItem(storageKey);}catch{/* Already persisted on the server. */}dirty=false;saving=false;await dialog.close();try{await onSaved?.();}catch(error){reportError(error,'人员已添加，列表刷新失败，请刷新核对');}notify.success('人员已添加，等待主席团确认后计入导出');
  }
  catch(error){uncertain=![400,403].includes(error.status);if(!uncertain)submitted=null;remember();reportError(error,'人员补录未完成');feedback.replaceChildren(notice(uncertain?'填写内容已保留，请在此窗口核对并重试，避免重复添加。':error.message,{tone:'warning'}));}
  finally{saving=false;onSaving(false);lock();}
 }});
 const cancel=button({label:'关闭',onClick:()=>dialog.close()});
 const body=h('div',{class:'stack-3'},
  notice('补录人员会同步到活动报名总表，并保留人工核验依据；主席团确认后才计入导出表。',{tone:'neutral'}),
  feedback,
  searchPeople?h('div',{class:'stack-2'},h('div',{class:'t-caption',text:'补录人员（必选）'}),searchInput,pickedBox,resultsBox):null,
  manualIdentity,email.node,
  position,detailsHost,reason,
  h('label',{},checked,' 已核对实际服务及补录依据'));
 resetDetails();paintPicked();body.addEventListener('input',()=>{dirty=true;remember();});body.addEventListener('change',()=>{dirty=true;remember();});
 dialog=openModal({title:'手动添加时长人员',width:850,body,footer:[cancel,save],onClose:onClosed});
 dialog.setCloseGuard(async()=>!saving&&(!dirty||await confirmAction({title:'关闭人员补录窗口？',description:'本次填写保留在当前浏览器会话中，再次打开可继续核对。',confirmLabel:'关闭窗口'})));lock();return dialog;
}
