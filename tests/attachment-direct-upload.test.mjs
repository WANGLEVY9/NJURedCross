import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { attachmentRoutes, clearAttachmentUploadTickets } from '../lib/attachment/api.js';
import { ATTACHMENT_PROVIDER_NJUBOX, ATTACHMENT_STATUS, attachmentRow } from '../lib/attachment/store.js';

const DIRECT_MAX = 500 * 1024 * 1024;

function createHarness({ rows = [], fetchImpl = null } = {}) {
  const calls = { json: [], audit: [], updated: [], fetched: [] };
  const client = {
    listRows: async (table) => (table === '活动项目表' ? [] : rows).map((row) => ({ ...row })),
    appendRow: async (_table, row) => {
      const created = { ...row, _id: `row-${rows.length + 1}` };
      rows.push(created);
      return created;
    },
    updateRow: async (_table, id, patch) => {
      calls.updated.push({ id, patch });
      const target = rows.find((row) => row._id === id);
      if (target) Object.assign(target, patch);
      return { ok: true };
    },
  };
  const ctx = {
    json: (res, status, payload) => { calls.json.push({ status, payload }); return payload; },
    readJson: async (req) => req.__body ?? {},
    getBase: async () => client,
    requirePortalSession: () => ({ username: 'tester' }),
    requireCsrf: () => true,
    recordAudit: async (_req, _s, action, target, outcome, detail) => {
      calls.audit.push({ action, target, outcome, detail });
    },
    enforceLimit: () => {},
    ownsBusinessRef: (s, value) => ['tester', 'ACC-1'].includes(String(value || '')),
    businessAccountRef: () => 'ACC-1',
    tables: { attachment: '投稿附件表', submission: '宣传投稿表', project: '活动项目表' },
    config: { njuboxToken: 'synthetic-token', njuboxFetch: async (url, init) => {
      calls.fetched.push({ url: String(url), method: init?.method || 'GET' });
      return fetchImpl(String(url), init);
    } },
  };
  return { ctx, calls, rows };
}

function req(method, url, json = null) {
  const stream = Readable.from([]);
  stream.method = method;
  stream.url = url;
  stream.headers = {};
  stream.__body = json;
  return stream;
}

const last = (calls) => calls.json.at(-1);

function pendingAttachment(id, filename = '大文件.pdf') {
  return attachmentRow({
    id, submissionId: '', filename, mimeType: 'application/pdf', size: 300 * 1024 * 1024,
    checksum: '', provider: ATTACHMENT_PROVIDER_NJUBOX, bucket: '', objectKey: '',
    status: ATTACHMENT_STATUS.pending, uploader: 'ACC-1', uploadedAt: '', boundAt: '',
    center: '', activity: '',
  });
}

test('大文件直传：票据绑定槽位，复核云盘后才落表，不重传字节', async () => {
  clearAttachmentUploadTickets();
  const directory = '/内容投稿/文创设计工作组/ATT-LARGE';
  const harness = createHarness({
    rows: [pendingAttachment('ATT-LARGE')],
    fetchImpl: (url, init) => {
      if (url.includes('/upload-link/')) return Promise.resolve(new Response(JSON.stringify('https://box.example/seafhttp/upload/abc')));
      if (url.includes('/dir/?') && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ success: true })));
      if (url.includes('/dir/?')) return Promise.resolve(new Response(JSON.stringify({ dirent_list: [{ type: 'file', name: '大文件.pdf', size: 300 * 1024 * 1024, mtime: '2026-11-26T15:00:00+08:00' }] })));
      return Promise.resolve(new Response('ok'));
    },
  });
  const ticketUrl = new URL('http://localhost/api/public/attachments/ATT-LARGE/upload-ticket');
  await attachmentRoutes(req('POST', ticketUrl.href, {
    filename: '大文件.pdf', mimeType: 'application/pdf', size: 300 * 1024 * 1024,
  }), {}, ticketUrl, harness.ctx);
  const issued = last(harness.calls);
  assert.equal(issued.status, 201, JSON.stringify(issued.payload));
  assert.ok(issued.payload.ticket.uploadUrl.startsWith('https://box.example/'));
  assert.equal(issued.payload.ticket.filename, '大文件.pdf');

  harness.calls.fetched.length = 0;
  const confirmUrl = new URL('http://localhost/api/public/attachments/ATT-LARGE/confirm');
  await attachmentRoutes(req('POST', confirmUrl.href, { ticketId: issued.payload.ticket.id }), {}, confirmUrl, harness.ctx);
  const confirmed = last(harness.calls);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.attachment.status, ATTACHMENT_STATUS.uploaded);
  assert.equal(confirmed.payload.attachment.size, 300 * 1024 * 1024);
  assert.equal(harness.rows[0]['上传状态'], ATTACHMENT_STATUS.uploaded);
  assert.ok(harness.calls.updated.some((item) => item.patch['对象Key']?.includes('ATT-LARGE')));
  assert.equal(harness.calls.audit.some((item) => item.outcome === 'success' && item.detail.mode === 'direct'), true);
  assert.ok(directory.includes('ATT-LARGE'));
  // 复核只列目录，不下载或再上传字节。
  assert.equal(harness.calls.fetched.some((item) => item.url.includes('seafhttp/upload')), false);
});

test('直传拒绝不属于自己的槽位、文件名不一致和超限文件', async () => {
  clearAttachmentUploadTickets();
  const harness = createHarness({ rows: [pendingAttachment('ATT-PRIVATE')] });
  harness.ctx.ownsBusinessRef = () => false;
  const url = new URL('http://localhost/api/public/attachments/ATT-PRIVATE/upload-ticket');
  await attachmentRoutes(req('POST', url.href, { filename: '大文件.pdf', mimeType: 'application/pdf', size: 1024 }), {}, url, harness.ctx);
  assert.equal(last(harness.calls).status, 403);

  const other = createHarness({ rows: [pendingAttachment('ATT-OTHER', '原稿.pdf')] });
  const otherUrl = new URL('http://localhost/api/public/attachments/ATT-OTHER/upload-ticket');
  await attachmentRoutes(req('POST', otherUrl.href, { filename: '改名.pdf', mimeType: 'application/pdf', size: 1024 }), {}, otherUrl, other.ctx);
  assert.equal(last(other.calls).status, 400);
  assert.equal(last(other.calls).payload.code, 'attachment_filename_mismatch');

  const huge = createHarness({ rows: [pendingAttachment('ATT-HUGE', '原稿.pdf')] });
  const hugeUrl = new URL('http://localhost/api/public/attachments/ATT-HUGE/upload-ticket');
  await attachmentRoutes(req('POST', hugeUrl.href, { filename: '原稿.pdf', mimeType: 'application/pdf', size: DIRECT_MAX + 1 }), {}, hugeUrl, huge.ctx);
  assert.equal(last(huge.calls).status, 413);
  assert.equal(last(huge.calls).payload.code, 'attachment_too_large');
});
