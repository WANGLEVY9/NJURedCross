/* global window, document */
/* Rendered accessibility audit for the birthday-wishes surfaces.
   Boots Playwright, drives the real UI (public + authenticated member),
   injects axe-core, and reports WCAG 2.2 A/AA violations per state. */
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const { source: axeSource } = createRequire(import.meta.url)('axe-core');

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const MEMBER = { username: 'local-member', password: 'Local-Member-2026!' };

async function runAxe(page, label) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    const { violations, incomplete } = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag22aa'] },
    });
    return { violations, incomplete };
  });
  const report = { label, violations: [], incomplete: [] };
  for (const item of results.violations) {
    report.violations.push({
      id: item.id,
      impact: item.impact,
      nodes: item.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    });
  }
  for (const item of results.incomplete) {
    report.incomplete.push({
      id: item.id,
      nodes: item.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    });
  }
  return report;
}

async function login(page, { username, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.selectOption('select[name="loginMode"]', 'other');
  await page.fill('input[name="alternate"]', username);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"], .btn--primary');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10000 });
}

const reports = [];
const browser = await chromium.launch();
async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'zh-CN', bypassCSP: true })).newPage();
  page.on('pageerror', (error) => console.error('[pageerror]', error.message));
  return page;
}
const page = await newPage();

await page.goto(`${BASE}/warmth`, { waitUntil: 'networkidle' });
await page.waitForSelector('.community-programs .program', { timeout: 10000 });
reports.push(await runAxe(page, 'public /warmth (signed out)'));

await login(page, MEMBER);
await page.goto(`${BASE}/warmth`, { waitUntil: 'networkidle' });
await page.waitForSelector('.community-programs .program', { timeout: 10000 });
reports.push(await runAxe(page, 'member /warmth'));

// Join drawer: use a fresh context + account if local-member has already enrolled.
let joinButton = page.getByRole('button', { name: /加入生日祝福/ });
let joinPage = page;
if (!(await joinButton.count())) {
  joinPage = await newPage();
  await login(joinPage, { username: 'test-user-01', password: 'Test-User-01-2026!' });
  await joinPage.goto(`${BASE}/warmth`, { waitUntil: 'networkidle' });
  await joinPage.waitForSelector('.community-programs .program', { timeout: 10000 });
  joinButton = joinPage.getByRole('button', { name: /加入生日祝福/ });
}
if (await joinButton.count()) {
  await joinButton.first().click();
  await joinPage.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await joinPage.waitForTimeout(400);
  reports.push(await runAxe(joinPage, 'join drawer'));
  await joinPage.keyboard.press('Escape');
}

const writeButton = page.getByRole('button', { name: /^写生日祝福$/ });
if (await writeButton.count()) {
  await writeButton.first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(400); // let the drawer entrance animation settle before measuring
  reports.push(await runAxe(page, 'blessing write drawer'));
  await page.keyboard.press('Escape');
}

await page.goto(`${BASE}/me`, { waitUntil: 'networkidle' });
await page.waitForSelector('#member-warmth-blessings, #member-warmth-enrollments', { timeout: 10000 });
reports.push(await runAxe(page, 'member /me warmth panels'));

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/warmth`, { waitUntil: 'networkidle' });
await page.waitForSelector('.community-programs .program', { timeout: 10000 });
reports.push(await runAxe(page, 'member /warmth @390px'));

await browser.close();

let failed = 0;
for (const report of reports) {
  console.log(`\n=== ${report.label} ===`);
  if (!report.violations.length && !report.incomplete.length) { console.log('  clean'); continue; }
  for (const item of report.violations) {
    failed += 1;
    console.log(`  [${item.impact}] ${item.id}`);
    for (const node of item.nodes) console.log(`      ${node}`);
  }
  for (const item of report.incomplete) {
    console.log(`  [needs-review] ${item.id}`);
    for (const node of item.nodes) console.log(`      ${node}`);
  }
}
console.log(`\nTOTAL violation rules: ${failed}`);
