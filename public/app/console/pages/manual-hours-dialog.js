import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {hoursFields,entryValues} from './hours-fields.js';
import {finalTrainingHours} from '../../shared/activity-final-hours.js';
import {getSessionState} from '../../core/api.js';

export function manualHoursDialog({key,positions,token,submit,loadLatest,onSaved,resume,integerTraining=false,onSaving=()=>{},onClosed=()=>{}}){
 const user=getSessionState().user,storageKey=`manual-hours:${user?.username||user?.accountId||''}:${key}`;let draft;
 try{draft=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{/* Storage is optional. */}
 if(!positions.some(row=>row.id===draft?.eventId))draft=null;
 if(!draft&&resume)draft={...resume,submitted:{...resume,...(token?{token}: {})}};
 const requestId=draft?.requestId||crypto.randomUUID();
 let saving=false,uncertain=!!draft?.submitted,dirty=!!draft,dialog,submitted=draft?.submitted;
 const identity=Object.fromEntries([['name','姓名'],['studentId','学号'],['department','院系'],['email','邮箱（可选）']].map(([name,label])=>[name,field({label,required:name!=='email',value:draft?.[name]||'',maxlength:name==='email'?160:120,type:name==='email'?'email':'text'})]));
 const feedback=h('div',{role:'status'}),detailsHost=h('div');let details;
 const position=field({label:'实际服务班次',required:true,value:draft?.eventId||positions[0]?.id,options:positions.map(row=>({value:row.id,label:row.name})),onInput:()=>resetDetails()});
 const reason=field({label:'补录依据',required:true,multiline:true,maxlength:500,value:draft?.reason||'',hint:'说明实际服务情况及核对依据。'});
 const checked=h('input',{type:'checkbox',checked:!!draft?.evidenceChecked,'aria-label':'已核对实际服务及补录依据'});
 checked.style.accentColor='var(--success, #23834b)';
 function resetDetails(){const event=positions.find(row=>row.id===position.control.value)?.event||{},values=draft?.details||entryValues(null,{报名日期:event['报名日期'],报名时段:event['报名时段']},event);if(integerTraining&&Number.isFinite(Number(values.trainingHours)))values.trainingHours=finalTrainingHours(values.trainingHours);details=hoursFields(values);if(integerTraining)details.node.querySelector('[data-hour-field="trainingHours"] input')?.setAttribute('step','1');draft=null;detailsHost.replaceChildren(details.node);}
 const payload=()=>({requestId,eventId:position.control.value,...Object.fromEntries(Object.entries(identity).map(([name,node])=>[name,node.control.value.trim()])),details:details.values(),reason:reason.control.value.trim(),evidenceChecked:checked.checked,...(token?{token}: {})});
 const remember=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify({...payload(),...(submitted?{submitted}: {})}));}catch{/* Preserve the open form even when browser storage is unavailable. */}};
 function lock(){for(const node of body.querySelectorAll('input,select,textarea,button'))node.disabled=saving||uncertain;save.disabled=saving;save.querySelector('span').textContent=uncertain?'核对并重试':'添加人员';cancel.disabled=saving;}
 const save=button({label:'添加人员',variant:'primary',onClick:async()=>{
  if(saving)return;
  const reconciling=Boolean(submitted);
  if(!submitted){if(!Object.values(identity).every(node=>node.control.reportValidity())||!details.valid()||!reason.control.reportValidity())return;if(!checked.checked){feedback.replaceChildren(notice('请先核对实际服务及补录依据',{tone:'warning'}));return;}submitted=payload();remember();}
  saving=true;onSaving(true);lock();
  try{
   if(reconciling&&loadLatest){
    const latest=await loadLatest();
    if(!latest||latest.status==='exported')throw Object.assign(Error('最终表已归档，不能继续补录，请关闭窗口核对最终名单'),{status:409});
    if(latest.canEdit!==true)throw Object.assign(Error('当前账号已无补录权限，请关闭窗口核对'),{status:409});
    if(!latest.positions?.some(row=>row.id===submitted.eventId))throw Object.assign(Error('原服务班次已变化，请关闭窗口核对；填写内容已保留'),{status:409});
    if(typeof latest.token!=='string'||!latest.token)throw Error('最新时长表版本未读取完整，请稍后核对重试');
    // Keep the immutable business request and its idempotency identity. Only the
    // separately validated version changes; never replay with a cached token.
    token=latest.token;submitted={...submitted,token};remember();
   }
   await submit(submitted);try{sessionStorage.removeItem(storageKey);}catch{/* Already persisted on the server. */}dirty=false;saving=false;await dialog.close();try{await onSaved?.();}catch(error){reportError(error,'人员已添加，列表刷新失败，请刷新核对');}notify.success('人员已添加，可继续核对时长');
  }
  catch(error){uncertain=![400,403].includes(error.status);if(!uncertain)submitted=null;remember();reportError(error,'人员补录未完成');feedback.replaceChildren(notice(uncertain?'填写内容已保留，请在此窗口核对并重试，避免重复添加。':error.message,{tone:'warning'}));}
  finally{saving=false;onSaving(false);lock();}
 }});
 const cancel=button({label:'关闭',onClick:()=>dialog.close()});
 const body=h('div',{class:'stack-3'},notice('补录人员会同步到活动报名总表，并保留人工核验依据；献血车同时关联排班底表。',{tone:'neutral'}),feedback,position,h('div',{class:'activity-draft-grid'},...Object.values(identity)),detailsHost,reason,h('label',{},checked,' 已核对实际服务及补录依据'));
 resetDetails();body.addEventListener('input',()=>{dirty=true;remember();});body.addEventListener('change',()=>{dirty=true;remember();});
 dialog=openModal({title:'手动添加时长人员',width:850,body,footer:[cancel,save],onClose:onClosed});
 dialog.setCloseGuard(async()=>!saving&&(!dirty||await confirmAction({title:'关闭人员补录窗口？',description:'本次填写保留在当前浏览器会话中，再次打开可继续核对。',confirmLabel:'关闭窗口'})));lock();return dialog;
}
