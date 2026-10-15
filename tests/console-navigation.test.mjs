import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSOLE_SECTIONS,
  consoleSection,
  visibleConsoleSections,
} from '../public/app/console/navigation.js';

test('eight ordered management sections share stable routes', () => {
  assert.deepEqual(CONSOLE_SECTIONS.map(section => section.label), [
    '总览',
    '管理员中心',
    '活动管理',
    '宣传管理',
    '内建管理',
    '物资管理',
    '红会留言墙',
    '工作助手',
  ]);

  assert.equal(
    new Set(CONSOLE_SECTIONS.map(section => section.path)).size,
    8,
  );

  assert.equal(consoleSection('/console/agent').path, '/console/agent');
  assert.equal(consoleSection('/console/agent-invalid'), null);
});

test('legacy tools highlight their owning section and do not match unrelated prefixes', () => {
  assert.equal(consoleSection('/console/settings').path, '/console/admin');
  assert.equal(consoleSection('/console/data').path, '/console/admin');
  assert.equal(consoleSection('/console/volunteers').path, '/console/events');
  assert.equal(consoleSection('/console/workflow').path, '/console/events');
  assert.equal(consoleSection('/console/events-invalid'), null);
  for (const path of ['/console/materials/intake', '/console/materials/returns', '/console/reimbursements', '/console/reimbursements/summary']) {
    assert.equal(consoleSection(path).path, '/console/materials');
  }
  assert.equal(consoleSection('/console/reimbursements-invalid'), null);
});

test('limited administrators see assigned sections and the shared assistant entry', () => {
  assert.deepEqual(
    visibleConsoleSections(scope => scope === 'events')
      .map(section => section.label),
    ['总览', '管理员中心', '活动管理', '工作助手'],
  );

  assert.equal(
    visibleConsoleSections(scope => scope === 'community')
      .some(section => section.path === '/console/messages'),
    true,
  );

  assert.deepEqual(
    visibleConsoleSections(() => false).map(section => section.label),
    ['总览', '管理员中心', '工作助手'],
  );
});
