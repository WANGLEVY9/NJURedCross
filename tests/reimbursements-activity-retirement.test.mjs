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
