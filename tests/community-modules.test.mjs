import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shellSource = await readFile(new URL('../public/app/console/shell.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../public/app/main.js', import.meta.url), 'utf8');
const birthdayPage = await readFile(new URL('../public/app/console/pages/community.js', import.meta.url), 'utf8');
const morningPage = await readFile(new URL('../public/app/console/pages/morning.js', import.meta.url), 'utf8');
const moduleNav = await readFile(new URL('../public/app/console/community-nav.js', import.meta.url), 'utf8');
const adminCss = await readFile(new URL('../public/styles/admin.css', import.meta.url), 'utf8');

test('管理端温暖连接直接拆分为早安晚安与生日祝福两个并列模块', () => {
  assert.ok(shellSource.includes("group: '温暖连接'"), 'warmth navigation group missing');
  assert.ok(shellSource.includes("path: '/console/community/morning'") && shellSource.includes("label: '早安晚安'"), 'morning module route missing');
  assert.ok(shellSource.includes("path: '/console/community/birthday'") && shellSource.includes("label: '生日祝福'"), 'birthday module route missing');
  assert.ok(mainSource.includes("path: '/console/community/birthday'"), 'birthday console route missing');
  assert.ok(mainSource.includes("guard: () => '/console/community/birthday'"), 'legacy warmth route must redirect to a module');
  assert.ok(morningPage.includes("communityModuleNav('morning')"), 'morning page must render the module switch');
  assert.ok(birthdayPage.includes("communityModuleNav('birthday')"), 'birthday page must render the module switch');
  assert.ok(moduleNav.includes("label: '早安晚安'") && moduleNav.includes("label: '生日祝福'"), 'module switch labels missing');
  assert.ok(moduleNav.includes("data: { active: String(active) }"), 'active module must be visually marked');
  assert.ok(adminCss.includes('.community-module-nav__item[data-active="true"]'), 'prominent active module styling missing');
});

test('生日祝福管理页只读取 birthday 数据且不再提供早安晚安共用流程', () => {
  assert.ok(birthdayPage.includes("label: '温暖连接 · 生日祝福'"), 'birthday page label missing');
  assert.ok(birthdayPage.includes('function isBirthdayProgram'), 'birthday module filter missing');
  assert.ok(birthdayPage.includes('(payload.interests || []).filter(isBirthdayProgram)'), 'interests must be birthday-only');
  assert.ok(birthdayPage.includes('(payload.submissions || []).filter(isBirthdayProgram)'), 'submissions must be birthday-only');
  assert.ok(birthdayPage.includes('(payload.current || []).filter(isBirthdayProgram)'), 'personal participation must be birthday-only');
  assert.ok(!birthdayPage.includes('openComingSoon'), 'birthday console must not expose the old shared coming-soon flow');
  assert.ok(!birthdayPage.includes("label: '早安晚安（开发中）'"), 'birthday console must not mix morning into its join flow');
});
