import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf('async function readOutreachAttachmentIndex(');
const end = source.indexOf('async function readOutreachReviews(', start);
assert.ok(start >= 0 && end > start, '投稿附件索引函数应存在');

/**
 * 夹具：把 readOutreachAttachmentIndex 单独放进 vm。
 *
 * `readPagedRows` 与 `attachmentFromRow` 都换成立桩，目的是锁定契约——
 * 这张表必须翻页读全，不能退回「一次 listRows 带一个硬编码 limit」。
 */
function fixture(rows) {
  const calls = { paged: 0, pagedOptions: null, listRows: 0 };
  const client = {
    async listRows() { calls.listRows++; return []; },
  };
  const box = {
    readPagedRows: async (_client, table, options) => {
      calls.paged++;
      calls.pagedOptions = { table, ...options };
      return rows;
    },
    attachmentFromRow: row => ({
      id: row['附件ID'],
      submissionId: row['投稿ID'],
      filename: row['文件名'],
      size: row['文件大小'],
      mimeType: row['MIME类型'],
      objectKey: row['对象键'],
      provider: row['存储提供方'],
      status: row['上传状态'],
      uploadedAt: row['上传时间'],
    }),
    SUBMISSION_ATTACHMENT_TABLE: '投稿附件表',
    ATTACHMENT_STATUS: Object.freeze({ uploaded: '已上传', deleted: '已删除' }),
    ATTACHMENT_PROVIDER_NJUBOX: 'njubox',
  };
  vm.createContext(box);
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.index = readOutreachAttachmentIndex;`, box);
  return { calls, run: c => box.index(c) };
}

test('attachment index pages through the whole table instead of one oversized request', async () => {
  const f = fixture([]);
  await f.run({ listRows: async () => { throw new Error('不应直接调用 listRows'); } });

  assert.equal(f.calls.listRows, 0, '不得绕过分页直接读一页');
  assert.equal(f.calls.paged, 1);
  assert.equal(f.calls.pagedOptions.table, '投稿附件表');
  assert.equal(f.calls.pagedOptions.requireComplete, true, '必须要求读全，不许静默截断');
});

test('attachment index keeps only uploaded NJU Box rows and groups them by submission', async () => {
  const f = fixture([
    { 附件ID: 'ATT-2', 投稿ID: 'SUB-1', 文件名: '配图.png', 对象键: '/p/ATT-2/配图.png', 存储提供方: 'njubox', 上传状态: '已上传', 上传时间: '2026-11-02T10:00:00Z', 文件大小: 2048, MIME类型: 'image/png' },
    { 附件ID: 'ATT-1', 投稿ID: 'SUB-1', 文件名: '正文.docx', 对象键: '/p/ATT-1/正文.docx', 存储提供方: 'njubox', 上传状态: '已上传', 上传时间: '2026-11-01T10:00:00Z', 文件大小: 4096, MIME类型: 'application/msword' },
    { 附件ID: 'ATT-3', 投稿ID: 'SUB-1', 文件名: '未传.pptx', 对象键: '/p/ATT-3/x.pptx', 存储提供方: 'njubox', 上传状态: '待上传', 上传时间: '2026-11-03T10:00:00Z' },
    { 附件ID: 'ATT-4', 投稿ID: 'SUB-2', 文件名: '旧版.pdf', 对象键: '/o/ATT-4/x.pdf', 存储提供方: 'aliyun-oss', 上传状态: '已上传', 上传时间: '2026-11-01T11:00:00Z' },
    { 附件ID: 'ATT-5', 投稿ID: '', 文件名: '未绑定.png', 对象键: '/p/ATT-5/x.png', 存储提供方: 'njubox', 上传状态: '已上传', 上传时间: '2026-11-01T12:00:00Z' },
  ]);
  const index = await f.run({});

  assert.deepEqual(Object.keys(index), ['SUB-1'], '只有已上传且已绑定的 NJU Box 附件入索引');
  // vm 里造的数组原型与本 realm 不同，先展开成当前 realm 的数组再比。
  assert.deepEqual([...index['SUB-1']].map(item => item.id), ['ATT-1', 'ATT-2'], '同一投稿内按上传时间升序');
  assert.equal(index['SUB-1'][0].contentType, 'application/msword');
  assert.equal(index['SUB-1'][0].objectKey, '/p/ATT-1/正文.docx');
});
