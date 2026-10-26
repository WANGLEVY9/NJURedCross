import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { workflowApprovalHash } from '../lib/events/workflow.js';
import { projectWorkflowEvents } from '../lib/events/public-workflow.js';
import { publicWorkflowEvents } from '../lib/events/public-workflow-events.js';
import { registrationOpen } from '../public/app/shared/activity-management.js';

function published(patch = {}) {
  const row = { _id: 'blood-row', 活动ID: 'WF-blood', 活动名称: '献血车第100周', 活动类别: '献血车志愿服务', 状态: '报名中', 申请版本: '1', 批准版本: '1', 容量: '8', 报名日期: '2026-10-12', 报名时段: '上午 11~15点', 地点: '新街口中央', 工作内容: '志愿服务', 负责人账号ID: 'private-account', 报名页配置: JSON.stringify({ window: { start: '2026-10-12T11:00:00+08:00', end: '2026-10-12T15:00:00+08:00' } }), ...patch };
  row['批准摘要'] = workflowApprovalHash(row);
  return row;
}
test('previously approved activities remain public when independent contact settings are present',()=>{
  const row=published({活动名称:'合成献血周',报名页配置:JSON.stringify({window:{start:'2030-10-29T08:30:00+08:00',end:'2030-10-29T16:30:00+08:00'}})});
  const contact={...row,报名页配置:JSON.stringify({...JSON.parse(row['报名页配置']),registrationContact:{name:'合成联系人',phone:'synthetic-private-contact'}})};
  for(const status of ['报名中','进行中','已结束']){
    const current={...contact,状态:status};
    assert.equal(workflowApprovalHash(current),row['批准摘要']);
    const [publicRow]=projectWorkflowEvents([current],[]);
    assert.equal(publicRow.name,'合成献血周');
    assert.equal(publicRow.status,status);
    assert.equal(JSON.stringify(publicRow).includes('synthetic-private-contact'),false);
  }
  assert.deepEqual(projectWorkflowEvents([{...contact,容量:'9'}],[]),[]);
  assert.deepEqual(projectWorkflowEvents([{...contact,批准版本:'0'}],[]),[]);
  assert.deepEqual(projectWorkflowEvents([{...contact,状态:'已归档'}],[]),[]);
});
test('only approved published workflow activities join the anonymous catalogue', () => {
  const row = published();
  const stale = { ...row, _id: 'changed', 容量: '9' };
  const events = projectWorkflowEvents([row, stale, published({ 状态: '待审核' }), published({ 状态: '停点' }), published({ 状态: '已归档' })], []);
  assert.equal(events.length, 1);
  assert.equal(events[0].workflowId, 'blood-row');
  assert.equal(events[0].eventId, 'workflow:blood-row');
  assert.equal(events[0].startAt, '2026-10-12T11:00:00+08:00');
  assert.ok(!JSON.stringify(events).includes('private-account'));
});
test('public workflow counters include only the selected activity without personal data', () => {
  const registrations = ['已确认', '已签到', '待筛选', '未入选', '已请假'].map(报名状态 => ({ 活动ID: 'WF-blood', 报名状态, 邮箱: 'private@smail.nju.edu.cn' }));
  registrations.push({ 活动ID: 'another', 报名状态: '已确认' });
  const [event] = projectWorkflowEvents([published()], registrations);
  assert.equal(event.confirmed, 2); assert.equal(event.remaining, 5); assert.equal(event.pending, 1);
  assert.ok(!JSON.stringify(event).includes('private@'));
});

test('running and ended activities stay public with registration closed in both projections', () => {
  for (const status of ['报名中','进行中','已结束']) {
    const row=published({状态:status});
    const [event]=projectWorkflowEvents([row],[]);
    const [detail]=publicWorkflowEvents({events:[row],registrations:[]});
    assert.equal(event.status,status);
    assert.equal(detail.status,status);
    assert.equal(event.registrationOpen,status==='报名中');
    assert.equal(detail.registrationOpen,status==='报名中');
    assert.equal(registrationOpen(row),status==='报名中');
  }
});

test('closed activities still require approval and never expose grouped parents or superseded rows', () => {
  for (const status of ['进行中','已结束']) {
    const rows=[published({状态:status,批准版本:''}),published({状态:status,sourceSuperseded:true}),published({状态:status,报名页配置:JSON.stringify({bookingMode:'grouped'})})];
    assert.deepEqual(projectWorkflowEvents(rows,[]),[]);
    assert.deepEqual(publicWorkflowEvents({events:rows,registrations:[]}),[]);
  }
  const scheduled=published({报名页配置:JSON.stringify({publishAt:'2099-01-01T00:00:00+08:00'})});
  assert.deepEqual(projectWorkflowEvents([scheduled],[]),[]);
  assert.deepEqual(publicWorkflowEvents({events:[scheduled],registrations:[]}),[]);
});

test('ordinary groups retain running and ended status after the shared publication gate closes', () => {
  const now=Date.parse('2026-10-01T00:00:00+08:00');
  const session=(status,index)=>published({_id:`session-${index}`,状态:status,报名页配置:JSON.stringify({ordinary:{groupId:'group',start:'2026-10-12T09:00:00+08:00',end:'2026-10-12T12:00:00+08:00'}}),registrationControl:{published:status==='报名中',enabled:true,deadline:'2026-10-10T00:00:00+08:00'}});
  for (const [statuses,expected] of [[['进行中','进行中'],'进行中'],[['已结束','已结束'],'已结束'],[['已结束','进行中'],'进行中'],[['已结束','报名中'],'报名中']]) {
    const rows=statuses.map(session);
    const [event]=projectWorkflowEvents(rows,[],now);
    assert.equal(event.status,expected);
    assert.equal(event.sessions.length,2);
    assert.equal(event.registrationOpen,expected==='报名中');
    const details=publicWorkflowEvents({events:rows,registrations:[]},now);
    assert.equal(details.length,2);
    details.forEach((detail,index)=>assert.equal(detail.registrationOpen,statuses[index]==='报名中'));
  }
});

test('blood catalogue preserves open booking sessions across weeks and hides closed sessions',()=>{
  const now=Date.parse('2026-10-25T12:00:00+08:00');
  const dates=['2026-10-05','2026-10-12','2026-10-13','2026-10-19','2026-10-25','2026-10-26','2026-11-02','2026-11-03','2026-11-09'];
  const rows=dates.map((date,index)=>published({_id:`blood-${index}`,活动ID:`blood-${index}`,报名日期:date,状态:date<'2026-10-25'?'已结束':'报名中',地点:index%2?'合成甲点':'合成乙点',报名页配置:JSON.stringify({blood:{start:`${date}T09:00:00+08:00`,end:`${date}T17:00:00+08:00`}})}));
  const catalogue=projectWorkflowEvents(rows,[],now);
  const running=catalogue.filter(event=>event.status==='进行中');
  const ended=catalogue.filter(event=>event.status==='已结束');
  const registering=catalogue.filter(event=>event.status==='报名中');
  assert.equal(running.length,0);assert.equal(ended.length,0);assert.equal(registering.length,5);
  const details=publicWorkflowEvents({events:rows,registrations:[]},now);
  assert.equal(details.length,5);
  assert.deepEqual(details.map(event=>event.date),['2026-10-25','2026-10-26','2026-11-02','2026-11-03','2026-11-09']);
  assert.ok(details.every(event=>event.status==='报名中'&&event.registrationOpen));
  const closedBookingWeek=rows.filter(row=>row['报名日期']==='2026-11-02').map(row=>({...row,状态:'进行中'}));
  assert.deepEqual(projectWorkflowEvents(closedBookingWeek,[],now),[]);
  assert.deepEqual(publicWorkflowEvents({events:closedBookingWeek,registrations:[]},now),[]);
});
test('the public catalogue combines existing projects and workflow activities', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function loadPublicEvents('), source.indexOf('async function getMaterialsOverview('));
  const context = { process: { env: { PLATFORM_TEST_WORKFLOW: 'true' } }, volunteerBaseUuid: 'test', TEST_WORKFLOW_BASE: 'test', eventProjectTable: 'projects', eventSessionTable: 'sessions', eventRegistrationTable: 'registrations',
    listAllRows: async (_client, table) => table === 'projects' ? [{ name: 'existing', eventId: 'legacy', status: '报名中' }] : [],
    isPubliclyListed: () => true, publicEventProjection: row => row, projectWorkflowEvents,
    getPublicWorkflowData: async () => ({ events: [published()], registrations: [] }),
  };
  vm.createContext(context); vm.runInContext(block + ';globalThis.load=loadPublicEvents', context);
  const result = await context.load({});
  assert.equal(result.length, 2); assert.ok(result.some(event => event.workflowId === 'blood-row'));
  context.process.env.PLATFORM_TEST_WORKFLOW = 'false';
  assert.equal((await context.load({})).length, 1);
});
