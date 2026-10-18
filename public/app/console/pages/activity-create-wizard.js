import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {button,definitionList,notice} from '../../ui/primitives.js';
import {configureProjectPositions} from './activity-positions.js';
import {publicationPanel} from './activity-management.js';
import {activityCreateSteps} from './activity-create-steps.js';

export async function continueActivityCreation({id,onBack,onSaved,step=2}){
 const root='/api/volunteer/workflow';
 try{
  const data=await request(`${root}/events/${encodeURIComponent(id)}/detail`,{fresh:true});
  const event=data.events.find(row=>row._id===id);
  if(!event||event['状态']!=='草稿'){notify.warning('活动已变化，请刷新后继续编辑');return;}
  const config=JSON.parse(event['报名页配置']||'{}');
  const next=nextStep=>continueActivityCreation({id,onBack,onSaved,step:nextStep});
  const backToInfo=()=>onBack(event);
  if(step===2&&config.bookingMode==='grouped'){
   configureProjectPositions(event,onSaved,{onContinue:()=>next(3),onBack:backToInfo,steps:activityCreateSteps(2)});return;
  }
  if(step===2){
   let drawer;
   drawer=openDrawer({title:'岗位安排',description:event['活动名称'],width:720,body:h('div',{class:'stack-4'},activityCreateSteps(2),notice('整体活动统一报名，无需额外配置岗位。',{tone:'neutral'}),definitionList([['岗位',event['岗位']||'默认服务岗'],['时间',config.window?`${config.window.start.slice(0,19).replace('T',' ')} — ${config.window.end.slice(0,19).replace('T',' ')}`:`${event['报名日期']} ${event['报名时段']}`],['地点',event['地点']],['推荐录取 / 报名上限',`${event['容量']} / ${config.registrationLimit||event['容量']} 人`]])),footer:[button({label:'上一步',onClick:async()=>{if(await drawer.close())await backToInfo();}}),button({label:'下一步：报名通知',variant:'primary',onClick:async()=>{if(await drawer.close())await next(3);}})]});return;
  }
  let drawer,finished=false;
  const editor=publicationPanel(event,{config,editable:true,mutate:async(path,body={},method='POST',acknowledge)=>{
   const response=await request(root+path,{method,body});acknowledge?.();
   if(path.endsWith('/submit')){finished=true;await drawer.close();notify.success('已提交审批，等待指定审核人处理');await onSaved();}
   else notify.success('通知草稿已保存');
   return response;
  }});
  drawer=openDrawer({title:'通知与审批',description:event['活动名称'],width:1080,workspace:true,body:h('div',{class:'stack-4'},activityCreateSteps(3),editor),
   beforeClose:async()=>finished||!editor.isSaving()&&(!editor.hasUnsaved()||await confirmAction({title:'放弃未保存的通知修改？',confirmLabel:'放弃修改'})),onClose:()=>editor.dispose(),
   footer:[button({label:'上一步',onClick:async()=>{if(await drawer.close())await next(2);}}),button({label:'退出，保留已保存草稿',onClick:async()=>{if(await drawer.close())await onSaved();}})]});
 }catch(error){reportError(error,'草稿已保留，暂时无法打开下一步，请刷新后继续');}
}
