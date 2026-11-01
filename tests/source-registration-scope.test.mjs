import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../public/app/console/pages/legacy-activity-workspace.js', import.meta.url), 'utf8');

test('console never sends the retired session scope to the registration switch', () => {
  // 2026-11-01：排班看板的单场按钮传了 'session'，而接口只接受 event/project/selection，
  // 业务点「结束报名」时收到「报名开关参数无效」。这里守住词汇表，避免再次漂移。
  assert.doesNotMatch(workspace, /changeSourceRegistration\s*\([^)]*'session'/);
  assert.match(workspace, /changeSourceRegistration\(event,enabled,'event',control\)/);
  const scopes = [...workspace.matchAll(/changeSourceRegistration\(row,[^)]*?'([a-z]+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(scopes)].sort(), ['event', 'project']);
  assert.match(workspace, /scope:'selection'/);
});
