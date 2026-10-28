import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { resolveSignInAccount } from '../lib/identity/store.js';

function row(patch = {}) {
  return {
    _id: 'synthetic-row',
    登录名: 'admin@smail.nju.edu.cn',
    邮箱: 'admin@smail.nju.edu.cn',
    密码哈希: 'synthetic-hash',
    角色: 'platform_admin',
    真实姓名: '合成管理员',
    学号: '251380003',
    状态: '启用',
    邮箱已验证: '已验证',
    ...patch,
  };
}

function clientFor(rows) {
  return {
    async query() { return rows; },
    async listRows() { return rows; },
  };
}

test('administrators sign in with their student id and name', async () => {
  const client = clientFor([row()]);

  for (const key of ['251380003', '合成管理员', 'admin@smail.nju.edu.cn']) {
    const resolved = await resolveSignInAccount(client, key);
    assert.equal(resolved.account?.username, 'admin@smail.nju.edu.cn', key);
    assert.equal(resolved.ambiguous, false);
  }
});

test('repeated identifiers stay ambiguous across roles', async () => {
  const client = clientFor([
    row(),
    row({ _id: 'member-row', 登录名: '251380003@nju.edu.cn', 邮箱: '251380003@nju.edu.cn', 角色: 'member' }),
  ]);

  const byStudentId = await resolveSignInAccount(client, '251380003');
  assert.equal(byStudentId.account, null);
  assert.equal(byStudentId.ambiguous, true);

  const byEmail = await resolveSignInAccount(client, 'admin@smail.nju.edu.cn');
  assert.equal(byEmail.account?.username, 'admin@smail.nju.edu.cn');
});

async function throttle() {
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('const LOGIN_FAIL_WINDOW_MS');
  const end = source.indexOf('function requireSession', start);
  assert.ok(start > 0 && end > start, '登录限流代码定位失败');

  const box = vm.createContext({ loginAttempts: new Map(), Date });
  vm.runInContext(`${source.slice(start, end)};globalThis.throttle={loginStatus,recordFailedLogin,clearLoginFailures};`, box);
  return box.throttle;
}

test('five wrong passwords block only that mailbox on a shared address', async () => {
  const t = await throttle();

  for (let i = 0; i < 4; i += 1) t.recordFailedLogin('203.0.113.9', 'someone@smail.nju.edu.cn');
  assert.equal(t.loginStatus('203.0.113.9', 'someone@smail.nju.edu.cn').allowed, true);

  t.recordFailedLogin('203.0.113.9', 'someone@smail.nju.edu.cn');
  const own = t.loginStatus('203.0.113.9', 'someone@smail.nju.edu.cn');
  assert.equal(own.allowed, false);
  assert.ok(own.retryAfter > 0);

  // Another person behind the same address is not locked out by those typos.
  assert.equal(t.loginStatus('203.0.113.9', 'other@smail.nju.edu.cn').allowed, true);

  t.clearLoginFailures('203.0.113.9', 'someone@smail.nju.edu.cn');
  assert.equal(t.loginStatus('203.0.113.9', 'someone@smail.nju.edu.cn').allowed, true);
});

test('a shared address is still blocked after many failures across mailboxes', async () => {
  const t = await throttle();

  for (let i = 0; i < 24; i += 1) t.recordFailedLogin('203.0.113.10', `user-${i}@smail.nju.edu.cn`);
  assert.equal(t.loginStatus('203.0.113.10', 'fresh@smail.nju.edu.cn').allowed, true);

  t.recordFailedLogin('203.0.113.10', 'user-24@smail.nju.edu.cn');
  const blocked = t.loginStatus('203.0.113.10', 'fresh@smail.nju.edu.cn');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);
});
