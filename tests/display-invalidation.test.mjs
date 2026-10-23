import test from 'node:test';
import assert from 'node:assert/strict';
import { withDisplayReads, isDisplayRead, isDisplayRequest, displayRead, clearDisplayReads, invalidateDisplayReads } from '../lib/http/display-reads.js';
import { readFile } from 'node:fs/promises';
import { createWriteJournal, withWriteJournal, writtenTables, trackClient } from '../lib/cache/write-tracker.js';

test('workspace shares display reads while mutations and auth never enable them', async () => {
  const path = '/api/volunteer/workflow/workspace';
  assert.equal(isDisplayRequest('GET', path), true);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']) assert.equal(isDisplayRequest(method, path), false);
  for (const path of ['/api/auth/me', '/api/auth/logout', '/api/volunteer/workflow/approval-routing']) {
    assert.equal(isDisplayRequest('GET', path), false);
  }
  assert.equal(isDisplayRead(), false);
  await withDisplayReads(async () => assert.equal(isDisplayRead(), true));
  assert.equal(isDisplayRead(), false);
});

test('directory reuse is limited to display reads and mutations validate a fresh directory', async () => {
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const definition = source.match(/async function eventDirectory\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition);
  let calls = 0;
  const directory = new Function('isDisplayRead', 'loadEventDirectory', 'directoryCacheTtlMs',
    `let directorySnapshot={at:0,promise:null};return ${definition};`
  )(isDisplayRead, async () => ++calls, () => 60_000);
  await withDisplayReads(async () => {
    assert.equal(await directory(), 1);
    assert.equal(await directory(), 1);
  });
  assert.equal(await directory(), 2);
  assert.equal(await directory(), 3);
  await withDisplayReads(async () => assert.equal(await directory(), 1));
});

test('account invalidation blocks stale in-flight refill and mutations ignore cached account rows', async () => {
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const definitions = source.match(/const accountRefreshCache=new Map\(\);[\s\S]*?\n(?=\/\*\* 账号)/)?.[0];
  assert.ok(definitions);
  let calls = 0, finishOld;
  const state = new Function('findAccountByLogin', 'getIdentityBase', 'accountRefreshTtlMs',
    `${definitions};return {loadSessionAccount,invalidateAccountRefresh};`
  )(async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finishOld = resolve; });
    return { status: 'disabled', revision: calls };
  }, async () => ({}), () => 5_000);
  const old = state.loadSessionAccount('user', { allowCache: true });
  await Promise.resolve();
  state.invalidateAccountRefresh();
  assert.deepEqual(await state.loadSessionAccount('user', { allowCache: true }), { status: 'disabled', revision: 2 });
  finishOld({ status: 'active', revision: 1 });
  await old;
  assert.deepEqual(await state.loadSessionAccount('user', { allowCache: true }), { status: 'disabled', revision: 2 });
  assert.deepEqual(await state.loadSessionAccount('user'), { status: 'disabled', revision: 3 });
  assert.deepEqual(await state.loadSessionAccount('user'), { status: 'disabled', revision: 4 });
});

test('identity and profile writes invalidate account/directory snapshots only where appropriate', async () => {
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(source, /const identityBase = identityApiToken \? trackClient/);
  assert.match(source, /const profileBase=.*\?trackClient/);
  const definition = source.match(/function invalidateWrittenSnapshots\(table\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition);
  const calls = [];
  const invalidate = new Function('ACCOUNT_TABLE', 'invalidateAccountRefresh', 'invalidateEventDirectory', 'invalidateAccountsSnapshot', 'invalidateDisplayReads', 'invalidatePublicSnapshots', 'publicReadCache',
    `return ${definition};`
  )('平台账号表', () => calls.push('account'), () => calls.push('directory'), () => calls.push('accounts'), names => calls.push(['display', names]), names => calls.push(['public', names]), { clear: () => assert.fail('must use targeted invalidation') });
  invalidate('平台账号表');
  assert.deepEqual(calls.splice(0), ['account', 'accounts', 'directory', ['display', ['平台账号表']], ['public', ['平台账号表']]]);
  invalidate('个人主页（编辑版）');
  assert.deepEqual(calls.splice(0), ['directory', ['display', ['个人主页（编辑版）']], ['public', ['个人主页（编辑版）']]]);
  invalidate('events');
  assert.deepEqual(calls, [['display', ['events']], ['public', ['events']]]);
});

test('a write only drops the projections that depend on the written table', async () => {
  clearDisplayReads();
  const base = {};
  const read = (table, value) => withDisplayReads(() => displayRead(
    base,
    `rows:${table}`,
    async () => value,
    5_000,
    [table],
  ));

  assert.equal(await read('网站活动流程表', 'events-v1'), 'events-v1');
  assert.equal(await read('网站服务时长明细表', 'ledger-v1'), 'ledger-v1');

  invalidateDisplayReads(['网站活动流程表']);

  assert.equal(await read('网站活动流程表', 'events-v2'), 'events-v2');
  assert.equal(await read('网站服务时长明细表', 'ledger-v2'), 'ledger-v1');
});

test('an explicit failure after partial writes still invalidates the recorded projections', async () => {
  clearDisplayReads();
  const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(source, /const display = isDisplayRequest\(req.method, url.pathname\)/);
  const cleanup = source.match(/\} finally \{\n( {8}if \(journal\.size\)[^\n]*)/)?.[1];
  assert.ok(cleanup);
  const finish = new Function('journal', 'res', 'url', 'invalidateWrittenSnapshots', cleanup);
  const base = trackClient({
    updateRow: async () => ({ ok: true }),
    batchUpdateRows: async () => { throw new Error('partial upstream failure'); },
  });
  for (const [statusCode, pathname] of [[409, '/api/volunteer/workflow'], [500, '/api/auth/profile']]) {
    const journal = createWriteJournal();
    const read = (table, value) => withDisplayReads(() => displayRead(base, table, () => value, 5_000, [table]));
    await read('events', 'old');
    await read('unrelated', 'retained');
    await withWriteJournal(journal, async () => {
      await base.updateRow('events', 'row', {});
      await assert.rejects(base.batchUpdateRows('events', []), /partial/);
    });
    finish(journal, { statusCode }, { pathname }, table => invalidateDisplayReads([table]));
    assert.equal(await read('events', 'fresh'), 'fresh');
    assert.equal(await read('unrelated', 'must not replace'), 'retained');
    clearDisplayReads();
  }
});

test('settled write callbacks cover background attempts without changing Promise identity', async () => {
  clearDisplayReads();
  let resolveWrite, rejectWrite;
  const succeeded = new Promise(resolve => { resolveWrite = resolve; });
  const failed = new Promise((_resolve, reject) => { rejectWrite = reject; });
  const notifications = [];
  const raw = { updateRow: () => succeeded, batchUpdateRows: () => failed, deleteRow: () => { throw new Error('sync failure'); } };
  const base = trackClient(raw, { onWrite: table => {
    notifications.push(table);
    invalidateDisplayReads([table]);
  } });
  assert.equal(trackClient(raw), base);
  assert.equal(trackClient(base), base);
  const read = value => withDisplayReads(() => displayRead(base, 'events', () => value, 5_000, ['events']));
  await read('old');
  assert.equal(base.updateRow('events', 'row', {}), succeeded);
  assert.deepEqual(notifications, []);
  assert.equal(await read('before-write'), 'old');
  resolveWrite('result');
  assert.equal(await succeeded, 'result');
  assert.equal(await read('after-write'), 'after-write');
  assert.equal(base.batchUpdateRows('events', []), failed);
  rejectWrite(new Error('partial failure'));
  await assert.rejects(failed, /partial failure/);
  assert.equal(await read('after-partial-failure'), 'after-partial-failure');
  assert.throws(() => base.deleteRow('events', 'row'), /sync failure/);
  assert.deepEqual(notifications, ['events', 'events', 'events']);
  assert.deepEqual(writtenTables(createWriteJournal()), []);
  clearDisplayReads();
});

test('invalidation callback failures cannot change successful or failed writes', async () => {
  const base = trackClient({ appendRow: () => 'success', deleteRow: () => { throw new Error('write error'); } }, {
    onWrite: () => { throw new Error('cache error'); },
  });
  assert.equal(base.appendRow('events', {}), 'success');
  assert.throws(() => base.deleteRow('events', 'row'), /write error/);
});

test('writes recorded outside a request journal are ignored', () => {
  const journal = createWriteJournal();
  const client = trackClient({ updateRow: async () => ({ _id: 'x' }) });

  return withWriteJournal(journal, async () => {
    await client.updateRow('网站活动报名总表', 'row', { 状态: '已确认' });
    assert.deepEqual(writtenTables(journal), ['网站活动报名总表']);
  });
});

test('tracked writes never change the SDK return value and drop duplicates', async () => {
  const calls = [];
  const client = trackClient({
    appendRow: async (table, row) => { calls.push([table, row]); return { _id: 'new' }; },
    listRows: async () => ['rows'],
  });
  const journal = createWriteJournal();

  await withWriteJournal(journal, async () => {
    assert.deepEqual(await client.appendRow('网站活动签到表', { a: 1 }), { _id: 'new' });
    await client.appendRow('网站活动签到表', { a: 2 });
    assert.deepEqual(await client.listRows('网站活动签到表'), ['rows']);
  });

  assert.deepEqual(calls, [['网站活动签到表', { a: 1 }], ['网站活动签到表', { a: 2 }]]);
  assert.deepEqual(writtenTables(journal), ['网站活动签到表']);
});

test('write tracking keeps the original this binding and records nothing outside a journal', async () => {
  let received = null;
  const target = {
    updateRow(table, id, patch) {
      received = { self: this, table, id, patch };
      return Promise.resolve({ ok: true });
    },
  };
  const client = trackClient(target);

  assert.deepEqual(await client.updateRow('表', 'id', { a: 1 }), { ok: true });
  assert.equal(received.self, target);
  assert.equal(received.table, '表');
  assert.equal(writtenTables(undefined).length, 0);
});
