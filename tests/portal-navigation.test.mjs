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
test('materials square keeps the 2026-10-21 name instead of the older finance-era label', () => {
  // 10-11 曾改名“财务物资广场”，10-21 改回“物资广场”；10-25 的错误回退带回过旧名，
  // 10-28 的物资提交又覆盖了一次。Owner 在 10-29 明确要求保留“物资广场”。
  const materials = PORTAL_NAV.find(item => item.path === '/materials');
  assert.equal(materials.label, '物资广场');
  assert.equal(materials.shortLabel, '物资');
  assert.equal(materials.description, '了解借用流程，申请活动所需物资');
});

test('no portal module falls back to the older finance-era label', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../public/app/portal/', import.meta.url);
  const files = await readdir(root, { recursive: true });
  const offenders = [];
  for (const file of files) {
    if (!String(file).endsWith('.js')) continue;
    const text = await readFile(new URL(file, root), 'utf8');
    if (text.includes('财务物资')) offenders.push(file);
  }
  assert.deepEqual(offenders, [], 'portal modules still use the finance-era label');
});
