import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

/**
 * 夹具：把 server.js 里被截取的一段函数体放进 vm。
 *
 * 这些函数的共同契约是「整表必须翻页读」，不能退回一次 listRows 带一个
 * 硬编码 limit——SeaTable 单页上限 1000，写死更大的数字只会拿到第一页，
 * 且不报错。
 */
function sandbox(start, end, stubs) {
  assert.ok(start >= 0 && end > start, '被截取的函数体应存在');
  const box = { ...stubs };
  vm.createContext(box);
  vm.runInContext(source.slice(start, end), box);
  return box;
}

/* ------------------------------------------------------------------ *
 * 投稿附件全表：附件绑定校验
 * ------------------------------------------------------------------ */

const attachmentStart = source.indexOf('async function readSubmissionAttachmentRows(');
const attachmentEnd = source.indexOf('async function readOutreachAttachmentIndex(', attachmentStart);

function attachmentFixture(rows) {
  const calls = { paged: [], listRows: 0 };
  const box = sandbox(attachmentStart, attachmentEnd, {
    readPagedRows: async (client, table, options) => {
      calls.paged.push({ client, table, options });
      return rows;
    },
    SUBMISSION_ATTACHMENT_TABLE: '投稿附件表',
  });
  return { calls, run: client => box.readSubmissionAttachmentRows(client) };
}

test('附件绑定校验走整表翻页，不得退回单页硬编码 limit', async () => {
  const f = attachmentFixture([]);
  const client = { async listRows() { f.calls.listRows += 1; return []; } };

  await f.run(client);

  assert.equal(f.calls.listRows, 0, '不得绕过分页直接读一页');
  assert.equal(f.calls.paged.length, 1);
  assert.equal(f.calls.paged[0].table, '投稿附件表');
  assert.equal(f.calls.paged[0].options.requireComplete, true, '必须要求读全，不许静默截断');
  assert.ok(
    f.calls.paged[0].options.maxRows > 1_000,
    '上限必须高于 SeaTable 单页 1000，否则等于没改',
  );
});

test('附件绑定校验把行原样交回调用方', async () => {
  const rows = [{ _id: 'r1', 附件ID: 'ATT-1' }];
  const f = attachmentFixture(rows);
  const got = await f.run({});

  assert.equal(got.length, 1);
  assert.equal(got[0]['附件ID'], 'ATT-1');
});

test('两条公众投稿写路径都复用同一个附件读取助手', () => {
  const article = source.slice(
    source.indexOf("url.pathname === '/api/public/submissions/article'"),
    source.indexOf("url.pathname === '/api/public/submissions/design'"),
  );
  const design = source.slice(
    source.indexOf("url.pathname === '/api/public/submissions/design'"),
    source.indexOf("url.pathname === '/api/public/submissions/design'") + 4_000,
  );

  for (const [label, chunk] of [['推文投稿', article], ['文创投稿', design]]) {
    assert.match(chunk, /readSubmissionAttachmentRows\(client\)/, `${label}应复用翻页助手`);
    assert.doesNotMatch(
      chunk,
      /client\.listRows\(\s*SUBMISSION_ATTACHMENT_TABLE/,
      `${label}不得再自己单页读附件表`,
    );
  }
});

test('server.js 里不再有对附件表/志愿活动表的单页硬编码读取', () => {
  assert.doesNotMatch(
    source,
    /listRows\(\s*SUBMISSION_ATTACHMENT_TABLE\s*,[^)]*\d{3,}/,
    '附件表不得出现硬编码 limit 的单页读',
  );
  assert.doesNotMatch(
    source,
    /listRows\(\s*WF\.events\s*,[^)]*\d{3,}/,
    '志愿服务平台活动表不得出现硬编码 limit 的单页读',
  );
});

/* ------------------------------------------------------------------ *
 * 跨库活动候选
 * ------------------------------------------------------------------ */

const catalogStart = source.indexOf('let submissionActivityCache');
const catalogEnd = source.indexOf('const attachmentCtx = {', catalogStart);

function catalogFixture(rows) {
  const calls = { paged: [], listRows: 0 };
  const box = sandbox(catalogStart, catalogEnd, {
    readPagedRows: async (client, table, options) => {
      calls.paged.push({ table, options });
      return rows;
    },
    getVolunteerBase: async () => ({ async listRows() { calls.listRows += 1; return []; } }),
    finishedSubmissionActivities: input => input.map(row => row['活动名称']),
    WF: { events: '网站活动流程表' },
  });
  return { calls, run: () => box.finishedSubmissionActivityCatalog() };
}

test('跨库活动候选翻页读志愿平台活动表', async () => {
  const f = catalogFixture([{ 活动名称: '献血周' }]);
  const got = await f.run();

  assert.equal(f.calls.listRows, 0, '不得绕过分页直接读一页');
  assert.equal(f.calls.paged.length, 1);
  assert.equal(f.calls.paged[0].table, '网站活动流程表');
  assert.ok(f.calls.paged[0].options.maxRows > 1_000, '上限必须高于单页 1000');
  assert.equal(got.length, 1);
  assert.equal(got[0], '献血周');
});

test('跨库活动候选在读取失败时降级为空，不拖垮投稿', async () => {
  const box = sandbox(catalogStart, catalogEnd, {
    readPagedRows: async () => { throw new Error('volunteer base down'); },
    getVolunteerBase: async () => ({}),
    finishedSubmissionActivities: () => [],
    WF: { events: '网站活动流程表' },
  });

  assert.deepEqual([...(await box.finishedSubmissionActivityCatalog())], []);
});

test('跨库活动候选有 60 秒缓存，避免每次投稿都跨库整表读', async () => {
  const f = catalogFixture([]);
  await f.run();
  await f.run();
  await f.run();

  assert.equal(f.calls.paged.length, 1, '缓存期内只读一次');
});
