import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer} from '../../ui/overlay.js';
import {protectDrawerDraft} from '../../ui/drawer-draft.js';
import {field,button,runWithLoading} from '../../ui/primitives.js';

export function configureProjectPositions(event,onSaved){
 const c=JSON.parse(event['报名页配置']||'{}'),plan=c.positionPlan;
 const list=h('div',{class:'position-editor__list stack-5'}),items=[];
 let drawer,busy=false,guard;
 const deadline=field({label:'统一报名截止（北京时间）',type:'datetime-local',step:1,required:true,value:plan?.deadline?.slice(0,19)||''});
 function add(seed={}){
  const inputs=[['name','岗位名称','text'],['capacity','可报名人数','number'],['location','服务地点','text'],['campus','校区','text'],['start','岗位开始时间','datetime-local'],['end','岗位结束时间','datetime-local']].map(([key,label,type])=>{
   const node=field({name:key,label,type,required:true,value:['start','end'].includes(key)?seed[key]?.slice(0,19)||'':seed[key]||'',...(key==='campus'?{options:['鼓楼','仙林','苏州']}:{}),...(['start','end','capacity'].includes(key)?{step:1}:{}),...(key==='capacity'?{min:1}:{})});return node;
  });
  const item={inputs,node:h('section',{class:'position-editor__item stack-3'})};
  item.node.append(h('div',{class:'row-between'},h('h3',{class:'t-h3',text:'报名岗位'}),button({label:'移除此岗位',variant:'ghost',onClick:()=>{if(plan)return;items.splice(items.indexOf(item),1);item.node.remove();}})),h('div',{class:'activity-formgrid'},...inputs));
  items.push(item);list.append(item.node);
 }
 for(const p of plan?.positions||[{}])add(p);
 const read=()=>({deadline:deadline.control.value,positions:items.map(item=>Object.fromEntries(item.inputs.map(f=>[f.control.name,f.control.value])))});
 const save=button({label:plan?'继续生成岗位':'保存岗位安排',variant:'primary',onClick:async()=>{
  if(busy||!deadline.control.reportValidity()||items.some(item=>item.inputs.some(f=>!f.control.reportValidity())))return;
  busy=true;drawer.body.inert=true;
  try{
   // The version token is server-generated and bound to approved activity content.
   await runWithLoading(save,()=>request(`/api/volunteer/workflow/events/${event._id}/configure-positions`,{method:'POST',body:{...read(),token:plan?.token||event['批准摘要']}}));
   guard.markSaved();busy=false;await drawer.close();notify.success('岗位已保存，尚未发布');
   try{await onSaved();}catch{notify.warning('岗位已保存，请刷新活动列表');}
  }catch(error){reportError(error,'岗位生成未完成，输入已保留；请核对后重试');}finally{busy=false;drawer.body.inert=false;}
 }});
 drawer=openDrawer({title:'配置报名岗位',description:`${event['活动名称']} · 总名额上限 ${event['容量']} 人`,width:1000,workspace:true,body:h('div',{class:'position-editor stack-5'},deadline,list,plan?null:button({label:'添加岗位',onClick:()=>add()})),footer:[button({label:'取消',onClick:()=>drawer.close()}),save]});
 if(plan){deadline.control.disabled=true;items.forEach(item=>item.inputs.forEach(f=>{f.control.disabled=true;}));}
 guard=protectDrawerDraft(drawer,{readFields:()=>[],readExtraState:read,isBusy:()=>busy});
}
