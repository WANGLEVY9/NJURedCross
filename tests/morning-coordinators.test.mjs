import test from 'node:test';
import assert from 'node:assert/strict';
import { MORNING_COORDINATORS, MORNING_COORDINATOR_TABLE, readMorningInviteCoordinators } from '../lib/morning/coordinators.js';

const rowsFor = region => MORNING_COORDINATORS[region].map((person, index) => ({
  _id: person.rowId, 姓名: person.name, 邮箱: `synthetic-${region}-${index}@smail.nju.edu.cn`,
}));

test('reports read only the fixed regional roster records and campus email column', async () => {
  for (const campus of ['鼓楼', '仙林', '浦口', '苏州', '苏州校区']) {
    const region = campus.startsWith('苏州') ? 'suzhou' : 'nanjing';
    const other = region === 'suzhou' ? 'nanjing' : 'suzhou';
    const rows = rowsFor(region);
    const client = { query: async sql => {
      assert.match(sql, /^SELECT `_id`, `姓名`, `邮箱` FROM /);
      assert.ok(sql.includes(`FROM \`${MORNING_COORDINATOR_TABLE}\``));
      assert.ok(sql.endsWith(`LIMIT ${rows.length + 1}`));
      for (const person of MORNING_COORDINATORS[region]) assert.ok(sql.includes(`'${person.rowId}'`));
      for (const person of MORNING_COORDINATORS[other]) assert.ok(!sql.includes(person.rowId));
      assert.ok(!sql.includes('邮箱2'));
      assert.ok(!sql.includes('学号'));
      return [...rows].reverse();
    } };
    assert.deepEqual(await readMorningInviteCoordinators(client, campus), rows.map(row => row.邮箱));
  }
});

test('each report reads current email while a same-name replacement cannot inherit the binding', async () => {
  const rows = rowsFor('suzhou');
  let reads = 0;
  const client = { query: async () => { reads++; return rows; } };
  assert.equal((await readMorningInviteCoordinators(client, '苏州'))[0], rows[0].邮箱);
  rows[0].邮箱 = 'new-contact@nju.edu.cn';
  assert.equal((await readMorningInviteCoordinators(client, '苏州'))[0], 'new-contact@nju.edu.cn');
  assert.equal(reads, 2);
  rows[0]._id = 'same-name-new-record';
  await assert.rejects(readMorningInviteCoordinators(client, '苏州'), { code: 'morning_coordinators_unavailable' });
});

test('missing, duplicated, truncated, unrelated or renamed roster records stop the whole group', async () => {
  const rows = rowsFor('nanjing');
  const invalid = [
    null, [], rows.slice(1), [...rows, rows[0]],
    [rows[0], rows[0], ...rows.slice(2)],
    Object.assign([...rows], { readMeta: { truncated: true } }),
    [{ ...rows[0], 姓名: '另一位同学' }, ...rows.slice(1)],
    [{ ...rows[0], _id: 'unbound-row' }, ...rows.slice(1)],
    [null, ...rows.slice(1)],
  ];
  for (const result of invalid) {
    await assert.rejects(readMorningInviteCoordinators({ query: async () => result }, '仙林'), {
      statusCode: 503, code: 'morning_coordinators_unavailable',
    });
  }
});

test('invalid campus emails never fall back to personal email or become extra recipients', async () => {
  for (const email of ['', null, {}, ['a@nju.edu.cn'], 'a@example.test', 'a@nju.edu.cn,b@nju.edu.cn', 'a@nju.edu.cn\r\nBcc:b@nju.edu.cn']) {
    const rows = rowsFor('suzhou');
    rows[0] = { ...rows[0], 邮箱: email, 邮箱2: 'backup@qq.com' };
    await assert.rejects(readMorningInviteCoordinators({ query: async () => rows }, '苏州'), {
      code: 'morning_coordinators_unavailable',
    });
  }
});

test('unknown campuses and source failures stop safely without leaking upstream errors', async () => {
  for (const campus of ['', '南京', '未知', "苏州' OR 1=1"]) {
    await assert.rejects(readMorningInviteCoordinators({ query: () => assert.fail('must not query') }, campus), { statusCode: 503 });
  }
  await assert.rejects(readMorningInviteCoordinators({}, '苏州'), { statusCode: 503 });
  await assert.rejects(readMorningInviteCoordinators({ query: async () => { throw Error('private-token-details'); } }, '苏州'), error =>
    error.code === 'morning_coordinators_unavailable' && !error.message.includes('private-token'));
});
