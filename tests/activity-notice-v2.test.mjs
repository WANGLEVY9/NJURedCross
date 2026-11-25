import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceNotice,isWorkspaceNoticeAuto} from '../public/app/shared/activity-workspace.js';
import {syncNoticeSchedule} from '../public/app/shared/activity-management.js';

const draft=region=>({name:'合成通知回归',region,description:'活动介绍',bookingMode:'grouped',deadline:'2030-01-02T10:30',positions:[{id:'one',name:'引导',date:'2030-01-02',start:'09:00',end:'12:00',location:'合成地点',capacity:'2',work:'现场引导',serviceHours:'3'}]});
test('regional notices have one content heading, unnumbered single position and adjacent deadline',()=>{
 for(const region of ['nanjing','suzhou']){
  const d=draft(region),notice=workspaceNotice(d);
  assert.ok(notice.startsWith(`${region==='suzhou'?'南苏':'南大'}红会 `));
  assert.equal(notice.match(/【活动内容】/g).length,1);
  assert.match(notice,/【活动内容】\n活动介绍\n引导\n/);
  assert.match(notice,/招募人数：2人\n【报名截止】1月2日 10:30（北京时间）/);
  assert.equal(isWorkspaceNoticeAuto({...d,notice}),true);
  assert.equal(isWorkspaceNoticeAuto({...d,notice:notice+'手工补充'}),false);
  for(const options of [{legacy:true},{previous:true}])assert.equal(isWorkspaceNoticeAuto({...d,notice:workspaceNotice(d,options)}),true);
 }
});
test('previous current-format notice remains auto-recognized, including its wrong region and blank line',()=>{
 const d=draft('suzhou');
 const notice=['南大红会 合成通知回归','【活动内容】活动介绍','【活动内容】','1. 引导','活动内容：现场引导','活动时间：2030-01-02 09:00-12:00','活动地点：合成地点','招募人数：2人','','【报名截止】2030-01-02 10:30','【报名方式】请在平台活动页面选择相应岗位并提交报名。','https://njuredcross.cn/events','【结果通知】报名审核结果将通过邮件通知，请留意查收；后续安排以活动通知为准。'].join('\n');
 assert.equal(isWorkspaceNoticeAuto({...d,notice}),true);
 assert.equal(isWorkspaceNoticeAuto({...d,notice:notice.replace('现场引导','手改工作')}),false);
});
test('multiple positions remain numbered and schedule shares deadline time formatting',()=>{
 const d=draft('nanjing');d.positions.push({...d.positions[0],id:'two',name:'签到'});
 const notice=syncNoticeSchedule(workspaceNotice(d),d.deadline);
 assert.match(notice,/1\. 引导/);assert.match(notice,/2\. 签到/);
 assert.match(notice,/【报名开始】1月2日 10:30 开始报名（北京时间）/);
 assert.match(notice,/【报名截止】1月2日 10:30（北京时间）/);
});
