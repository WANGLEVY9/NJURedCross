import test from 'node:test';
import assert from 'node:assert/strict';
import { friendBlessingTarget, friendSchemaReady, deliverFriendBlessings } from '../lib/community/friend-blessings.js';
import { inspectBirthdaySchema } from '../lib/community/birthday-rollout.js';
import { planBirthdaySchema } from '../lib/community/birthday-schema.js';
import { STATE_SCHEMA } from '../lib/production-schema.js';

test('next birthday is determined in Shanghai, supports today and leap days, and cannot be overridden', () => {
  const target = (birthday, date) => friendBlessingTarget({ friendEmail: 'Friend@Example.test', friendBirthday: birthday, scheduledDate: '1990-01-01' }, new Date(date));
  assert.deepEqual(target('10-26', '2026-10-25T16:30:00Z'), { friendEmail: 'friend@example.test', friendBirthday: '10-26', scheduledDate: '2026-10-26' });
  assert.equal(target('10-25', '2026-10-25T16:30:00Z').scheduledDate, '2027-10-25');
  assert.equal(target('02-29', '2026-01-01T00:00:00Z').scheduledDate, '2028-02-29');
  for (const birthday of ['02-30', '04-31', '00-01', '13-01', '10-0', '2026-10-25']) assert.throws(() => target(birthday, '2026-01-01T00:00:00Z'), { statusCode: 400 });
  for (const email of ['', {}, 'a@b', 'a@example.test,b@example.test', 'a@example.test\r\nBcc:x@example.test']) {
    assert.throws(() => friendBlessingTarget({ friendEmail: email, friendBirthday: '10-25' }), { statusCode: 400 });
  }
});

test('friend schema adds only three text columns and preserves existing birthday readiness', () => {
  const tables = STATE_SCHEMA.map(t => ({ name: t.name, columns: t.columns.map(name => ({ name, type: 'text' })) }));
  const table = tables.find(t => t.name === '温暖连接投稿表');
  table.columns = table.columns.filter(c => !['挚友邮箱', '挚友生日', '计划投递日期'].includes(c.name));
  assert.equal(friendSchemaReady({ tables }), false);
  assert.equal(inspectBirthdaySchema({ tables }).ready, true);
  assert.deepEqual(planBirthdaySchema({ tables }).find(t => t.name === table.name).columns, ['挚友邮箱', '挚友生日', '计划投递日期']);
  for (const name of ['挚友邮箱', '挚友生日', '计划投递日期']) table.columns.push({ name, type: 'text' });
  assert.equal(friendSchemaReady({ tables }), true);
  table.columns.at(-1).type = 'date';
  assert.equal(friendSchemaReady({ tables }), false);
});

function fixture() {
  const row = { _id: 's1', 投稿ID: 'CARE-FRIEND', 项目: 'birthday', 投递方式: '写给挚友', 状态: '已通过', 提交人: 'writer',
    挚友邮箱: 'friend@example.test', 挚友生日: '10-25', 计划投递日期: '2026-10-25', 内容: '生日快乐！', 署名昵称: '朋友' };
  const deliveries = [], messages = [], sent = new Set();
  const library = [{ 投稿ID: row.投稿ID, 分类: '写给挚友', 状态: '在库', 内容: row.内容, 署名昵称: row.署名昵称 }];
  const options = { submissions: [row], library, deliveries, now: new Date('2026-10-25T02:00:00Z'),
    eligibleAuthor: async () => true, identifier: () => 'DLV-1',
    client: {
      appendRow: async (table, value) => { assert.equal(table, '温暖祝福投递表'); return { _id: 'd1' }; },
      updateRow: async (_table, id, patch) => Object.assign(deliveries.find(r => r._id === id), patch),
    },
    send: async message => {
      if (sent.has(message.idempotencyKey)) return { ok: true, transport: 'idempotent-skip' };
      sent.add(message.idempotencyKey); messages.push(message);
      return { ok: true, transport: 'smtp' };
    },
  };
  return { row, deliveries, library, messages, options };
}

test('approved friend letters send to the given email once with a stable key and no site delivery', async () => {
  const f = fixture();
  assert.equal((await deliverFriendBlessings(f.options)).delivered, 1);
  await deliverFriendBlessings(f.options);
  f.options.now = new Date('2027-10-25T02:00:00Z');
  await deliverFriendBlessings(f.options);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].to, 'friend@example.test');
  assert.equal(f.messages[0].idempotencyKey, 'WARMTH-FRIEND:CARE-FRIEND:2026-10-25');
  assert.ok(!f.messages[0].text.includes('登录网站查看'));
  assert.equal(f.deliveries[0].收件人学号, '');
  assert.equal(f.deliveries[0].站内状态, '仅邮件');
  assert.ok(!f.deliveries[0].收件人标识.includes('@'));
});

test('pending, rejected, deleted, inactive-author, future and expired letters never send', async () => {
  for (const mutate of [f => { f.row.状态 = '待审核'; }, f => { f.row.状态 = '已拒绝'; },
    f => { f.library[0].状态 = '作者已删除'; }, f => { f.options.eligibleAuthor = async () => false; },
    f => { f.row.内容 = '审核后被改动的内容'; }, f => { f.row.署名昵称 = '审核后被改动的署名'; },
    f => { f.options.now = new Date('2026-10-24T02:00:00Z'); }, f => { f.options.now = new Date('2026-10-26T02:00:00Z'); }]) {
    const f = fixture(); mutate(f); await deliverFriendBlessings(f.options);
    assert.equal(f.messages.length, 0); assert.equal(f.deliveries.length, 0);
  }
});

test('lost receipt update reuses the same mail intent rather than sending another message', async () => {
  const f = fixture();
  const update = f.options.client.updateRow;
  f.options.client.updateRow = async () => { throw Error('lost reply'); };
  await assert.rejects(deliverFriendBlessings(f.options));
  assert.equal(f.messages.length, 1);
  f.options.client.updateRow = update;
  await deliverFriendBlessings(f.options);
  assert.equal(f.messages.length, 1);
  assert.equal(f.deliveries[0].邮件状态, '已发送');
});

test('unconfirmed receipt, changed recipient and development transport never claim success', async () => {
  const f = fixture();
  f.options.client.appendRow = async () => ({});
  await assert.rejects(deliverFriendBlessings(f.options), /receipt_unconfirmed/);
  assert.equal(f.messages.length, 0);
  const g = fixture(); g.options.send = async () => ({ ok: true, transport: 'console', devCodeChannel: true });
  await deliverFriendBlessings(g.options);
  assert.equal(g.deliveries[0].邮件状态, '发送失败');
  g.row.挚友邮箱 = 'someoneelse@example.test';
  g.options.send = async () => assert.fail('must not redirect an existing delivery');
  await deliverFriendBlessings(g.options);
});

test('friend nickname and lunar calendar schedule the next birthday with short-month fallback', () => {
 const body = { friendEmail:'friend@example.test', friendNickname:'小南', friendBirthdayCalendar:'lunar', friendBirthday:'01-01' };
 assert.equal(friendBlessingTarget(body,new Date('2026-10-25T00:00:00Z')).scheduledDate,'2027-02-06');
 assert.equal(friendBlessingTarget({...body,friendBirthday:'02-30'},new Date('2026-04-16T00:00:00Z')).scheduledDate,'2026-04-16');
 const result=friendBlessingTarget(body,new Date('2026-02-17T00:00:00Z'));
 assert.equal(result.friendNickname,'小南'); assert.equal(result.friendBirthdayCalendar,'lunar');
 assert.throws(()=>friendBlessingTarget({...body,friendNickname:''}),{statusCode:400});
 assert.throws(()=>friendBlessingTarget({...body,friendBirthdayCalendar:'bad'}),{statusCode:400});
 assert.throws(()=>friendBlessingTarget(body,new Date('2031-01-01T00:00:00Z')),{statusCode:400});
});

test('lunar friend letter uses nickname greeting and sends once on its computed date', async () => {
 const f=fixture();Object.assign(f.row,{挚友昵称:'小南',挚友生日历法:'lunar',挚友生日:'01-01',计划投递日期:'2027-02-06'});
 f.options.now=new Date('2027-02-06T00:00:00Z');
 assert.equal((await deliverFriendBlessings(f.options)).delivered,1);
 assert.ok(f.messages[0].text.startsWith('亲爱的小南：'));
 await deliverFriendBlessings(f.options);assert.equal(f.messages.length,1);
});
