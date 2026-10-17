import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {protectDrawerDraft} from '../../ui/drawer-draft.js';
import {enhanceDateTimeField} from '../../ui/date-time-picker.js';
import {field,button,runWithLoading} from '../../ui/primitives.js';

export function configureProjectPositions(event,onSaved,{onContinue}={}){
 const c=JSON.parse(event['报名页配置']||'{}'),plan=c.positionDraft||c.positionPlan;
 const originalCapacity=Number(event['容量']),originalLimit=Math.max(originalCapacity,Number(c.registrationLimit??originalCapacity));
 const list=h('div',{class:'position-editor__list'}),items=[];
 let drawer,busy=false,guard;
 const local=value=>value?.slice(0,19)||'';
 const deadline=enhanceDateTimeField(field({label:'统一报名截止（北京时间）',name:'deadline',type:'datetime-local',step:1,required:true,value:local(plan?.deadline),max:local(c.window?.start)}));
 const summary=h('strong',{'aria-live':'polite'}),warning=h('p',{class:'position-editor__error',role:'status','aria-live':'polite',hidden:true}),error=h('p',{class:'position-editor__error',role:'alert',hidden:true});
 const readItem=item=>Object.fromEntries(item.inputs.map(f=>[f.control.name,f.control.value]));
 const read=()=>({deadline:deadline.control.value,positions:items.map(readItem)});
 function sync(){
  const total=items.reduce((n,item)=>n+(Number(readItem(item).capacity)||0),0),changes=[];
  summary.textContent=`${items.length} 个岗位 · 总名额 ${total} 人 · 活动容量 ${originalCapacity} 人 · 报名上限 ${originalLimit} 人`;
  if(total>originalCapacity)changes.push(`活动容量将从 ${originalCapacity} 提升至 ${total} 人`);
  if(total>originalLimit)changes.push(`报名上限将从 ${originalLimit} 提升至 ${total} 人`);
  warning.hidden=!changes.length&&total<=100000;
  warning.textContent=total>100000?'岗位总名额不能超过 100000 人，请减少名额后保存。':changes.length?`保存后${changes.join('，')}。默认通知名额将同步更新；手工通知不会覆盖，请核对其中的名额说明。`:'';
  items.forEach((item,index)=>{item.title.textContent=`${String(index+1).padStart(2,'0')} · ${readItem(item).name||'新岗位'}`;});
 }
 function add(seed={},focus=false){
  if(items.length>=200){notify.warning('最多配置 200 个岗位');return;}
  const inputs=[['name','岗位名称','text'],['capacity','可报名人数','number'],['location','服务地点','text'],['campus','校区','text'],['start','岗位开始时间','datetime-local'],['end','岗位结束时间','datetime-local']].map(([key,label,type])=>{
   const node=field({name:key,label,type,required:true,value:['start','end'].includes(key)?local(seed[key]):seed[key]??(key==='campus'?'鼓楼':''),...(key==='campus'?{options:['鼓楼','仙林','浦口','苏州'].map(value=>({value,label:`${value}校区`}))}:{}),...(['start','end','capacity'].includes(key)?{step:1}:{}),...(key==='capacity'?{min:1,max:100000}:{}),...(['name','location'].includes(key)?{maxlength:500}:{}),...(['start','end'].includes(key)?{min:local(c.window?.start),max:local(c.window?.end)}:{})});
   if(type==='datetime-local')enhanceDateTimeField(node);return node;
  });
  const work=field({name:'work',label:'岗位工作内容',multiline:true,rows:4,maxlength:500,value:seed.work||'',hint:'填写此岗位的具体任务与要求（选填，最多 500 字）。'});
  work.classList.add('position-editor__work');inputs.push(work);
  const item={inputs,node:h('section',{class:'position-editor__item'}),title:h('h3')};
  item.node.append(h('header',{class:'position-editor__item-head'},item.title,h('div',{class:'position-editor__actions'},button({label:'复制岗位',onClick:()=>add(readItem(item),true)}),button({label:'移除此岗位',variant:'ghost',onClick:()=>{inputs.forEach(f=>f.disposeDateTimePicker?.());items.splice(items.indexOf(item),1);item.node.remove();sync();addButton.focus();}}))),h('div',{class:'position-editor__grid'},...inputs));
  items.push(item);list.append(item.node);sync();
  if(focus)inputs[0].control.focus();
 }
 const addButton=button({label:'添加岗位',onClick:()=>add({},true)});
 for(const p of plan?.positions||[{}])add(p);
 const initial=JSON.stringify(read());
 const save=button({label:onContinue?'保存并继续通知':'保存岗位安排',variant:'primary',onClick:async()=>{
  if(busy||!deadline.control.reportValidity()||items.some(item=>item.inputs.some(f=>!f.control.reportValidity())))return;
  const payload=read(),total=payload.positions.reduce((n,p)=>n+Number(p.capacity),0);
  const keys=payload.positions.map(p=>JSON.stringify([p.start,p.end,p.location.trim(),p.name.trim()]));
  const message=!items.length?'请至少添加一个岗位。':total>100000?'岗位总名额不能超过 100000 人。':new Set(keys).size!==keys.length?'存在重复岗位，请修改复制岗位的名称、时间或地点。':payload.positions.some(p=>p.end<=p.start)?'岗位结束时间必须晚于开始时间。':payload.deadline>=local(c.window?.start)?'报名截止须早于活动开始。':'';
  error.textContent=message;error.hidden=!message;if(message){error.scrollIntoView({block:'nearest'});return;}
  if(event['状态']==='报名中'&&JSON.stringify(payload)!==initial&&!await confirmAction({title:'保存并暂停项目报名？',description:'新岗位安排保存后，整个项目暂停接受新报名。已有报名保留；请检查后点击“统一发布岗位”重新开放。',confirmLabel:'保存岗位安排'}))return;
  busy=true;drawer.body.inert=true;
  try{
   const saved=await runWithLoading(save,()=>request(`/api/volunteer/workflow/events/${event._id}/configure-positions`,{method:'POST',body:{...payload,token:event.positionToken||plan?.token||event['批准摘要']}}));
   const result=saved.result||{},changes=[];
   if(!result.unchanged&&result.capacityAdjusted)changes.push(`活动容量已从 ${result.previousCapacity} 提升至 ${result.capacity} 人`);
   if(!result.unchanged&&result.registrationLimitAdjusted)changes.push(`报名上限已从 ${result.previousRegistrationLimit} 提升至 ${result.registrationLimit} 人`);
   guard.markSaved();busy=false;await drawer.close();notify.success([result.unchanged?'岗位安排未变化':result.draft?'岗位安排已保存，等待活动审批':'岗位已保存，请在活动信息中统一发布',...changes].join('；'));
   if(result.noticeReviewRequired)notify.warning('手工通知已保留，请核对通知中的名额说明后再发布');
   try{
    if(await onSaved?.(result)===false){notify.warning('岗位已保存，请刷新活动列表');return;}
    if(onContinue)await onContinue(result);
   }catch{notify.warning('岗位已保存，请刷新活动列表');}
  }catch(cause){reportError(cause,'岗位保存未完成，输入已保留；请核对后重试');}finally{busy=false;drawer.body.inert=false;}
 }});
 const body=h('div',{class:'position-editor'},h('section',{class:'position-editor__overview'},h('div',{},h('p',{class:'t-label',text:'报名安排'}),summary,warning,h('p',{class:'t-caption',text:`活动范围：${local(c.window?.start).replace('T',' ')} — ${local(c.window?.end).replace('T',' ')}（北京时间）`})),deadline),h('p',{class:'t-caption',text:'可在审批前准备岗位。复制后修改名称、时间或地点；保存不会自动发布。已发布活动修改安排后需重新统一发布，已有报名记录的岗位不能移除或改写。'}),error,list,addButton);
 const changed=()=>{error.hidden=true;sync();};body.addEventListener('input',changed);body.addEventListener('change',changed);
 drawer=openDrawer({title:'配置报名岗位',description:event['活动名称'],width:1080,workspace:true,body,onClose:()=>{deadline.disposeDateTimePicker?.();items.forEach(item=>item.inputs.forEach(f=>f.disposeDateTimePicker?.()));},footer:[button({label:'取消',onClick:()=>drawer.close()}),save]});
 guard=protectDrawerDraft(drawer,{readFields:()=>[],readExtraState:read,isBusy:()=>busy});
}
