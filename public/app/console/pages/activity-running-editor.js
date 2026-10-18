import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';

const columns=['姓名','学号','岗位与时间','服务时长','培训时长','交通时长','初审结果','原因','签到链接（选填）','已核对签到（选填）'];
const hourKeys=['serviceHours','trainingHours','travelHours'];
export function runningReviewEditor({rows,token,importFile,preview,submit,save,onSaved,onClosed=()=>{},single=false}){
 let items=rows.map(row=>({...row.item})),proof=null,busy=false,dirty=false,disposed=false,uncertain=false,dialog;
 const body=h('div',{class:'stack-3'}),feedback=h('div',{role:'status'});
 const file=field({label:'时长表（XLSX / CSV，40KB以内）',type:'file',accept:'.xlsx,.csv'});
 async function picked(){
  const chosen=file.control.files?.[0];if(!chosen||busy)return;
  if(chosen.size>40*1024){feedback.replaceChildren(notice('文件不能超过40KB',{tone:'warning'}));return;}
  busy=true;renderControls();
  try{
   const bytes=new Uint8Array(await chosen.arrayBuffer());let binary='';for(const value of bytes)binary+=String.fromCharCode(value);
   const result=await importFile({name:chosen.name,bytes:btoa(binary)});if(disposed)return;
   if(result.items.length!==rows.length||result.items.some(item=>!rows.some(row=>row.item.id===item.id)))throw Error('参与名单已变化，请关闭窗口并刷新名单后重新上传');
   items=result.items;token=result.token;dirty=true;proof=null;feedback.replaceChildren();render();
  }catch(error){reportError(error,'时长表读取失败');}finally{busy=false;renderControls();file.control.value='';}
 }
 file.control.addEventListener('change',()=>void picked());
 function table(editable){
  const tbody=h('tbody');
  const displayed=proof?proof.rows.map(row=>({...row,item:{id:row.id}})):rows;
  for(const row of displayed){
   const item=items.find(item=>item.id===row.item.id);if(!item)continue;
   const tr=h('tr',{},h('td',{text:row.name}),h('td',{text:row.studentId}),h('td',{text:[row.position,row.date,row.slot].filter(Boolean).join(' · ')}));
   for(const key of hourKeys){const input=h('input',{class:'input',type:'number',min:'0',max:'100000',step:'any',value:item[key]??'','aria-label':`${row.name} ${key==='serviceHours'?'服务':key==='trainingHours'?'培训':'交通'}时长`,on:{input:ev=>{item[key]=ev.target.value;item.decision='';item.evidenceChecked=false;tr.querySelector('select').value='';tr.querySelector('input[type=checkbox]').checked=false;dirty=true;proof=null;renderControls();}}});tr.append(h('td',{},editable?input:h('span',{text:String(item[key]??'—')})));}
   const select=h('select',{class:'input','aria-label':`${row.name} 初审结果`,on:{change:ev=>{item.decision=ev.target.value;dirty=true;}}},...['','pass','fail'].map((value,index)=>h('option',{value,text:['待选择','审核通过','不通过'][index]})));select.value=item.decision||'';
   const reason=h('input',{class:'input',value:item.reason||'',maxlength:500,'aria-label':`${row.name} 初审原因`,on:{input:ev=>{item.reason=ev.target.value;dirty=true;}}});
   const check=h('input',{type:'checkbox',checked:item.evidenceChecked===true,'aria-label':`${row.name} 已核对签到依据`,on:{change:ev=>{item.evidenceChecked=ev.target.checked;dirty=true;}}});
   const attendance=field({label:`${row.name} 签到链接（选填）`,type:'url',value:item.attendanceUrl||'',onInput:()=>{item.attendanceUrl=attendance.control.value.trim();dirty=true;}});
   tr.append(h('td',{},editable?select:h('span',{text:item.decision==='pass'?'初审通过':item.decision==='fail'?'初审不通过':'待初审'})),h('td',{},editable?reason:h('span',{text:item.reason||'—'})),h('td',{},editable?attendance:h('span',{text:item.attendanceUrl||'—'})),h('td',{},editable?check:h('span',{text:item.evidenceChecked?'已核对':'—'})));tbody.append(tr);
  }
  return h('div',{class:'activity-registration-table activity-running-review-table'},h('table',{},h('thead',{},h('tr',{},...columns.map(text=>h('th',{scope:'col',text})))),tbody));
 }
 function render(){body.replaceChildren(feedback,...(!single&&!proof?[file,h('p',{class:'t-caption',text:'列名：姓名、学号、服务时长、培训时长、交通时长。重复参与请增加岗位、日期或报名ID。'})]:[]),table(!proof));renderControls();}
 function renderControls(){
  if(disposed)return;for(const input of body.querySelectorAll('input,select'))input.disabled=busy||uncertain;
  primary.disabled=busy||uncertain;primary.textContent=single?'保存初审':proof?'提交':'预览时长表';back.hidden=!proof;back.disabled=busy||uncertain;cancel.disabled=busy;reconcile.hidden=!uncertain;reconcile.disabled=busy;
 }
 const cancel=button({label:'取消',onClick:()=>dialog.close()});
 const back=button({label:'返回修改',onClick:()=>{if(busy||uncertain)return;proof=null;render();}});
 const reconcile=button({label:'核对提交结果',onClick:async()=>{
  if(busy)return;busy=true;renderControls();try{const state=await onSaved();if(disposed)return;if(state?.status==='submitted'){dirty=false;busy=false;await dialog.close();notify.success('时长已提交');return;}token=state.token;uncertain=false;proof=null;feedback.replaceChildren(notice('已核对当前状态，请检查填写内容后重新预览',{tone:'neutral'}));}catch(error){reportError(error,'提交结果仍待核对');}finally{busy=false;render();}
 }});
 const primary=button({label:single?'保存初审':'预览时长表',variant:'primary',onClick:async()=>{
  if(busy||uncertain)return;busy=true;renderControls();let writing=false;
  try{
   if(single){writing=true;await save({token,items});await onSaved();dirty=false;busy=false;await dialog.close();notify.success('初审已保存');}
   else if(!proof){proof=await preview({token,items});items=proof.items;feedback.replaceChildren();render();}
   else{writing=true;await submit({token:proof.token,items:proof.items,previewToken:proof.previewToken});dirty=false;busy=false;await dialog.close();await onSaved();notify.success('已提交时长审核');}
  }catch(error){reportError(error,writing?'保存结果请核对后再操作':'请检查时长与初审结果');if(writing){uncertain=true;feedback.replaceChildren(notice('请先核对提交结果，填写内容已保留',{tone:'warning'}));}}
  finally{busy=false;renderControls();}
 }});
 render();dialog=openModal({title:single?'负责人初审':'上传与预览时长表',width:1400,body,footer:[cancel,reconcile,back,primary],onClose:()=>{disposed=true;dirty=false;onClosed();}});
 dialog.surface.classList.add('activity-running-modal');
 dialog.setCloseGuard(async()=>disposed||!busy&&(!dirty||await confirmAction({title:'放弃未保存的初审？',description:'已保存的内容会保留。',confirmLabel:'放弃修改'})));
 return {hasUnsaved:()=>!disposed&&dirty,isSaving:()=>busy,dispose:()=>{disposed=true;dirty=false;void dialog.close();}};
}
