import {workspaceWorkflowInput} from '../../lib/events/workspace-workflow-bridge.js';
import {WF,workflowApprovalHash} from '../../lib/events/workflow.js';

/** Explicit opt-in preview fixture: in-memory workflow only; never used by server.js. */
export async function seedSpecialActivities({workflow,rows,account,setTime}){
 setTime('2026-10-01T09:00:00+08:00');
 const content={name:'校医院体检',region:'nanjing',category:'排班专项',bookingMode:'grouped',date:'2026-10-12',endDate:'2026-12-31',qqGroup:'12345678',notice:'合成排班通知，仅供本地验证',work:'合成现场引导',special:{v:1,type:'schedule',dates:['2026-10-12','2026-10-14','2026-10-19'],cutoffMinutes:0,places:[{location:'鼓楼校医院',periods:[{start:'08:00',end:'12:00',capacity:3,serviceHours:4,trainingHours:0,travelHours:0},{start:'13:00',end:'17:00',capacity:3,serviceHours:4,trainingHours:0,travelHours:0}]}]}};
 const input=workspaceWorkflowInput(content),parent=await workflow.create(input.body,'synthetic-organizer'),saved=rows[WF.events].find(e=>e._id===parent._id),c=JSON.parse(saved['报名页配置']);c.special=input.special;saved['报名页配置']=JSON.stringify(c);
 await workflow.configurePositions(parent._id,{positions:input.positions,deadline:input.deadline,token:workflowApprovalHash(saved)},'synthetic-organizer');await workflow.approve(parent._id,'synthetic-super');await workflow.publish(parent._id);
 const sessions=rows[WF.events].filter(e=>JSON.parse(e['报名页配置']||'{}').special?.rootId===parent['活动ID']);
 for(const [i,event]of sessions.entries()){
  const member={...account,accountId:'synthetic-special-'+i,studentId:String(999980001+i),realName:'模拟排班同学'+(i+1),email:String(999980001+i)+'@smail.nju.edu.cn'};
  const registration=await workflow.register(event._id,member);if(i!==1)await workflow.confirm(registration._id);
 }
 const province=await workflow.enableRegistry({v:1,type:'province-service',dailyCapacity:4},'synthetic-super');
 const component=await workflow.enableRegistry({v:1,type:'component-donation'},'synthetic-super');
 await workflow.registryRegister(province.id,{requestId:'10000000-0000-4000-8000-000000000001',date:'2026-10-12'},account);
 setTime('2026-10-12T16:00:00+08:00');
 return {scheduleId:sessions[0]._id,parentId:parent._id,provinceId:province.id,componentId:component.id,content};
}
