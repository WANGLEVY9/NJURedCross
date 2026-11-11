import {workspaceWorkflowInput} from '../../lib/events/workspace-workflow-bridge.js';
import {WF,workflowApprovalHash} from '../../lib/events/workflow.js';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {storePhoto} from '../../lib/events/attendance-photo.js';

/** Explicit opt-in preview fixture: in-memory workflow only; never used by server.js. */
export async function seedSpecialActivities({workflow,rows,account,setTime}){
 setTime('2026-11-01T09:00:00+08:00');
 const content={name:'校医院体检',region:'nanjing',category:'排班专项',bookingMode:'grouped',date:'2026-11-09',endDate:'2026-12-31',qqGroup:'12345678',notice:'合成排班通知，仅供本地验证',work:'合成现场引导',special:{v:1,type:'schedule',dates:['2026-11-09','2026-11-12','2026-11-16'],cutoffMinutes:1440,places:[{location:'鼓楼校医院',periods:[{start:'08:00',end:'12:00',capacity:3,serviceHours:4,trainingHours:0,travelHours:0},{start:'13:00',end:'17:00',capacity:3,serviceHours:4,trainingHours:0,travelHours:0}]}]}};
 const input=workspaceWorkflowInput(content),parent=await workflow.create(input.body,'synthetic-organizer'),saved=rows[WF.events].find(e=>e._id===parent._id),c=JSON.parse(saved['报名页配置']);c.special=input.special;saved['报名页配置']=JSON.stringify(c);
 await workflow.configurePositions(parent._id,{positions:input.positions,deadline:input.deadline,token:workflowApprovalHash(saved)},'synthetic-organizer');await workflow.approve(parent._id,'synthetic-super');await workflow.publish(parent._id);
 const sessions=rows[WF.events].filter(e=>JSON.parse(e['报名页配置']||'{}').special?.rootId===parent['活动ID']);
 for(const [i,event]of sessions.entries()){
  const member={...account,accountId:'synthetic-special-'+i,studentId:String(999980001+i),realName:'模拟排班同学'+(i+1),email:String(999980001+i)+'@smail.nju.edu.cn'};
  const registration=await workflow.register(event._id,member);if(i!==1)await workflow.confirm(registration._id);
 }
 const scheduleReadOnlyExamples=[],scheduleExamples=[{id:sessions[0]._id,name:content.name,type:'schedule',positions:1}];
 for(const example of [{name:'校医院疫苗接种',type:'hospital-vaccination',positions:2},{name:'校医院体检（历史类型）',type:'hospital-examination',positions:1},{name:'校内服务排班（合成）',type:'schedule',positions:1},{name:'已开始排班（合成）',type:'schedule',positions:1,status:'进行中'},{name:'已结束排班（合成）',type:'schedule',positions:1,status:'已结束'}]){
  const sample={...content,name:example.name,special:{...content.special,type:example.type,dates:example.status?['2026-11-09']:['2026-11-09','2026-11-12','2026-11-14','2026-11-16'],places:example.positions===2?[...content.special.places,{...content.special.places[0],location:'仙林校医院'}]:content.special.places}};
  const prepared=workspaceWorkflowInput(sample),created=await workflow.create(prepared.body,'synthetic-organizer'),row=rows[WF.events].find(e=>e._id===created._id),settings=JSON.parse(row['报名页配置']);settings.special=prepared.special;row['报名页配置']=JSON.stringify(settings);
  await workflow.configurePositions(created._id,{positions:prepared.positions,deadline:prepared.deadline,token:workflowApprovalHash(row)},'synthetic-organizer');await workflow.approve(created._id,'synthetic-super');await workflow.publish(created._id);
  const child=rows[WF.events].find(e=>JSON.parse(e['报名页配置']||'{}').special?.rootId===created['活动ID']);
  if(example.status){for(const session of rows[WF.events].filter(e=>JSON.parse(e['报名页配置']||'{}').special?.rootId===created['活动ID']))session['状态']=example.status;scheduleReadOnlyExamples.push({...example,id:child._id});}
  else scheduleExamples.push({...example,id:child._id});
 }
 const province=await workflow.enableRegistry({v:1,type:'province-service',dailyCapacity:4},'synthetic-super');
 const component=await workflow.enableRegistry({v:1,type:'component-donation'},'synthetic-super');
 setTime('2026-11-11T16:00:00+08:00');
 const photoId=await storePhoto(Readable.from([await readFile(new URL('./demo-attendance.png',import.meta.url))]));
 await workflow.registryRegister(province.id,{requestId:'10000000-0000-4000-8000-000000000001',date:'2026-11-09',start:'09:00',end:'12:00',location:'鼓楼广场献血车',photoId},account);
 setTime('2026-11-11T16:00:00+08:00');
 await workflow.configureRecurringDuty({enabled:true},'synthetic-super');
 return {scheduleExamples,scheduleReadOnlyExamples,scheduleId:sessions[0]._id,parentId:parent._id,provinceId:province.id,componentId:component.id,content};
}
