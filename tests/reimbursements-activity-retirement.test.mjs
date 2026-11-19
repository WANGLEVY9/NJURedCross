import test from 'node:test';
import assert from 'node:assert/strict';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';

const final = { id: 'synthetic-final', financePermissions: ['final', 'view', 'payment'] };
const manual = { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', location: '合成地点',
  participantCount: 1, description: '合成用途', unitName: '合成单位', fundAccount: 'SYNTHETIC' };

/**
 * 目录曾把 11.15 YABC（八）应对暴力 记成 `workflow-group:<项目>`（活动还没进公开列表），
 * 后来活动结束公开、分组生效，目录改用首行 id `workflow:<行ID>`。持久化状态只做 upsert，
 * 旧 id 不清理，前端下拉就会列出两条一模一样的活动。
 */
test('a re-keyed activity leaves one picker row even though the retired id reached the stored state', async () => {
  const f = reimbursementTableFixture();
  let catalogue = [{ eventId: 'workflow-group:PROJECT-WS-yabc', name: '11.15 YABC（八）应对暴力', startAt: '2026-10-20T16:00:00+08:00', campus: '苏州' }];
  let service = f.makeService({ activityProvider: async () => catalogue });
  await service.summaries.saveActivity(final, manual);
  const before = (await service.summaries.listActivities(final)).activities;
  assert.deepEqual(before.map(item => item.id).sort(), ['synthetic-event', 'workflow-group:PROJECT-WS-yabc']);

  catalogue = [{ eventId: 'workflow:position-course', name: '11.15 YABC（八）应对暴力', startAt: '2026-10-20T16:00:00+08:00', campus: '苏州' }];
  service = f.makeService({ activityProvider: async () => catalogue });
  const after = (await service.summaries.listActivities(final)).activities;
  assert.deepEqual(after.map(item => item.id).sort(), ['synthetic-event', 'workflow:position-course']);
  assert.equal(after.filter(item => item.name === '11.15 YABC（八）应对暴力').length, 1);
});

test('the retirement is persisted by the next write, not just hidden from one read', async () => {
  const f = reimbursementTableFixture();
  let catalogue = [{ eventId: 'workflow-group:PROJECT-WS-yabc', name: '11.15 YABC（八）应对暴力', startAt: '2026-10-20T16:00:00+08:00', campus: '苏州' }];
  let service = f.makeService({ activityProvider: async () => catalogue });
  await service.summaries.saveActivity(final, manual);

  catalogue = [{ eventId: 'workflow:position-course', name: '11.15 YABC（八）应对暴力', startAt: '2026-10-20T16:00:00+08:00', campus: '苏州' }];
  service = f.makeService({ activityProvider: async () => catalogue });
  await service.summaries.saveActivity(final, { ...manual, revision: 1, name: '合成活动（改名）' });

  service = f.makeService({ activityProvider: async () => catalogue });
  assert.deepEqual((await service.summaries.listActivities(final)).activities.map(item => item.id).sort(),
    ['synthetic-event', 'workflow:position-course']);
});

/**
 * 献血车同一地点一天排两个班次，名称与日期完全相同，只有开始时间不同。
 * 目录同步必须把时段带进活动条目，否则下拉里两条选项文字一模一样。
 */
test('two shifts sharing a name and a date keep distinct slots after catalogue sync', async () => {
  const f = reimbursementTableFixture();
  const catalogue = [
    { eventId: 'workflow:BS-10', name: '市血液献血车 · 第51周 · 新街口印象汇', startAt: '2026-10-20T10:00:00+08:00', campus: '' },
    { eventId: 'workflow:BS-13', name: '市血液献血车 · 第51周 · 新街口印象汇', startAt: '2026-10-20T13:00:00+08:00', campus: '' },
  ];
  const service = f.makeService({ activityProvider: async () => catalogue });
  const list = (await service.summaries.listActivities(final)).activities;
  const shifts = list.filter(item => item.name === '市血液献血车 · 第51周 · 新街口印象汇');
  assert.equal(shifts.length, 2);
  assert.deepEqual(shifts.map(item => item.timeSlot).sort(), ['10:00', '13:00']);
  // 下拉文字就是这三段拼起来的，拼完必须唯一。
  assert.equal(new Set(shifts.map(item => `${item.name} · ${item.date} ${item.timeSlot}`)).size, 2);
});

test('editing an activity without resubmitting the slot keeps the one the catalogue supplied', async () => {
  const f = reimbursementTableFixture();
  const catalogue = [{ eventId: 'workflow:BS-10', name: '市血液献血车 · 第51周 · 新街口印象汇',
    startAt: '2026-10-20T10:00:00+08:00', campus: '' }];
  let service = f.makeService({ activityProvider: async () => catalogue });
  const synced = (await service.summaries.listActivities(final)).activities.find(item => item.id === 'workflow:BS-10');
  assert.equal(synced.timeSlot, '10:00');

  // 财务在活动资料表单里只改地点，表单不提交 timeSlot。
  service = f.makeService({ activityProvider: async () => catalogue });
  const saved = await service.summaries.saveActivity(final, { id: 'workflow:BS-10', revision: synced.revision,
    name: synced.name, date: synced.date, location: '新街口地铁站 3 号口', participantCount: 20,
    description: synced.description, campus: '南京' });
  assert.equal(saved.activity.timeSlot, '10:00');
});
