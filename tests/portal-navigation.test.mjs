import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PORTAL_NAV, portalSection } from '../public/app/portal/navigation.js';

test('legacy action routes remain associated with their new public square', () => {
  assert.equal(portalSection('/events/EVT-123'), '/events');
  assert.equal(portalSection('/workflow-events'), '/events');
  assert.equal(portalSection('/submit'), '/outreach');
  assert.equal(portalSection('/photos'), '/outreach');
  // 宣传展示并入宣传广场（要求1）：/showcase 与投稿台、影像库同域高亮。
  assert.equal(portalSection('/showcase'), '/outreach');
  assert.equal(portalSection('/warmth'), '/community');
  for (const path of ['/morning', '/morning/plaza', '/morning/comments']) assert.equal(portalSection(path), '/community');
  for (const path of ['/materials/borrow', '/materials/return', '/materials/reimburse', '/materials/rooms', '/materials/inbound', '/reimbursements']) assert.equal(portalSection(path), '/materials');
  for (const path of ['/status', '/change-password', '/register', '/login']) assert.equal(portalSection(path), '/me');
  for (const item of PORTAL_NAV) assert.equal(portalSection(item.path), item.path);
});
test('square matching does not mark unrelated paths or console navigation', () => {
  for (const path of ['/', '/console/events', '/events-extra', '/about', '/materials-old', '/showcase-wall']) assert.equal(portalSection(path), null);
  // 宣传展示已合并进宣传广场，主导航由 6 项收敛为 5 项。
  assert.equal(new Set(PORTAL_NAV.map(item => item.path)).size, 5);
});
test('materials square consistently uses the owner-approved finance/materials name', () => {
  // Owner confirmed the financial/materials plaza name for the current release.
  const materials = PORTAL_NAV.find(item => item.path === '/materials');
  assert.equal(materials.label, '财务物资广场');
  assert.equal(materials.shortLabel, '财务物资');
  assert.equal(materials.description, '办理财务报销、物资借还与场地借用');
});

test('portal modules do not retain the superseded standalone materials label', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../public/app/portal/', import.meta.url);
  const files = await readdir(root, { recursive: true });
  const offenders = [];
  for (const file of files) {
    if (!String(file).endsWith('.js')) continue;
    const text = await readFile(new URL(file, root), 'utf8');
    if (/(?<!财务)物资广场/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'portal modules still use the superseded materials-only label');
});
