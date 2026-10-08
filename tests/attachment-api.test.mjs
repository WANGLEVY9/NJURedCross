import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  attachmentRoutes,
  outreachSubmissionAttachments,
  validateAttachmentBinding,
  MAX_FILES_PER_SUBMISSION,
  MAX_UNBOUND_PER_ACCOUNT,
} from '../lib/attachment/api.js';
import { ATTACHMENT_PROVIDER_NJUBOX, ATTACHMENT_STATUS, attachmentRow } from '../lib/attachment/store.js';

/* -------------------------------------------------------------------------- *
 * 合成测试基建：内存行存储 + mock ctx + 可控 fetch，全程不联网。
 * -------------------------------------------------------------------------- */

function createHarness({ rows = [], ossConfig = {}, session = { username: 'tester', csrf: 'csrf-token' } } = {}) {
  const calls = { json: [], audit: [], updated: [] };
  const client = {
    listRows: async () => rows.map((row) => ({ ...row })),
    appendRow: async (table, row) => {
      const created = { ...row, _id: `row-${rows.length + 1}` };
      rows.push(created);
      return created;
    },
    updateRow: async (table, rowId, patch) => {
      calls.updated.push({ table, rowId, patch });
      const target = rows.find((row) => row._id === rowId);
      if (target) Object.assign(target, patch);
      return { ok: true };
    },
  };
  const ctx = {
    json: (res, status, payload) => {
      calls.json.push({ status, payload });
      return payload;
    },
    readJson: async (req) => req.__body ?? {},
    getBase: async () => client,
    requirePortalSession: () => session,
    requireCsrf: () => true,
    requireConsoleAccess: () => session,
    recordAudit: async (req, s, action, target, outcome, detail) => {
      calls.audit.push({ action, target, outcome, detail });
    },
    enforceLimit: () => {},
    ownsBusinessRef: (s, value) => ['tester', 'ACC-1'].includes(String(value || '')),
    businessAccountRef: () => 'ACC-1',
    tables: { attachment: '投稿附件表', submission: '宣传投稿表' },
    config: ossConfig,
  };
  return { ctx, calls, rows };
}

function makeReq({ method, url, headers = {}, body = null, json = null }) {
  const stream = Readable.from(body ? [body] : []);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  if (json !== null) stream.__body = json;
  return stream;
}

function apiUrl(pathname) {
  return new URL(`http://localhost${pathname}`);
}

function lastJson(calls) {
  assert.ok(calls.json.length, 'expected a json response');
  return calls.json[calls.json.length - 1];
}

/** 构造与 Content-Type 一致的 multipart 请求体。 */
async function multipartBody(filename, contentType, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  const response = new Response(form);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: { 'content-type': response.headers.get('content-type') },
  };
}

// 合成 NJU Box 配置：v2 主存储（Seafile Web API）。njuboxFetch 注入 mock。
const BOX_CONFIG = {
  njuboxToken: 'box-token-test',
  njuboxRepoId: 'repo-test-id',
  njuboxSubmissionsDir: '/内容投稿',
  njuboxMediaDir: '/影像素材',
  njuboxShowcaseDir: '/宣传展示',
};

/** Box fetch mock：upload-link / 上传 / 删除 / 直链，按 URL 分派。 */
function boxFetchMock(calls = [], { uploadLink = 'https://box.nju.edu.cn/seafhttp/upload/abc', fileLink = 'https://box.nju.edu.cn/seafhttp/files/abc' } = {}) {
  return async (url, init = {}) => {
    const href = String(url);
    const entry = { url: href, method: init.method || 'GET' };
    if (init.body && typeof init.body !== 'string') entry.hasBody = true;
    calls.push(entry);
    if (href.includes('/upload-link/')) return new Response(JSON.stringify(uploadLink), { status: 200 });
    if (href.includes('/file/?') && entry.method === 'GET') return new Response(JSON.stringify(fileLink), { status: 200 });
    return new Response('file-id-123', { status: 200 });
  };
}

function pendingRow(overrides = {}) {
  return attachmentRow({
    id: 'ATT-TEST-01',
    submissionId: '',
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 1024,
    checksum: '',
    provider: ATTACHMENT_PROVIDER_NJUBOX,
    bucket: '',
    objectKey: '',
    status: ATTACHMENT_STATUS.pending,
    uploader: 'ACC-1',
    uploadedAt: '',
    boundAt: '',
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- *
 * 槽位申请
 * -------------------------------------------------------------------------- */

test('slot creation validates the file type matrix', async () => {
  const harness = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'a.exe', mimeType: 'application/x-msdownload', size: 10 } }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 415);
  assert.equal(lastJson(harness.calls).payload.code, 'attachment_type_unsupported');
});

test('slot creation rejects oversized files per type', async () => {
  const harness = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'big.png', mimeType: 'image/png', size: 21 * 1024 * 1024 } }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 413);
  const video = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'ok.mp4', mimeType: 'video/mp4', size: 150 * 1024 * 1024 } }),
    {}, apiUrl('/api/public/attachments'), video.ctx,
  );
  assert.equal(lastJson(video.calls).status, 201);
});

test('slot creation writes a pending row with audit and quota cap', async () => {
  const harness = createHarness({
    rows: Array.from({ length: MAX_UNBOUND_PER_ACCOUNT }, (_, index) => pendingRow({ id: `ATT-FULL-${index}` })),
  });
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'one-more.png', mimeType: 'image/png', size: 10 } }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 429);
  assert.equal(lastJson(harness.calls).payload.code, 'attachment_quota_exceeded');

  const fresh = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: '现场照片.jpg', mimeType: 'image/jpeg', size: 2048 } }),
    {}, apiUrl('/api/public/attachments'), fresh.ctx,
  );
  const created = lastJson(fresh.calls);
  assert.equal(created.status, 201);
  assert.equal(created.payload.attachment.status, ATTACHMENT_STATUS.pending);
  assert.equal(fresh.rows[0]['上传状态'], ATTACHMENT_STATUS.pending);
  assert.equal(fresh.rows[0]['上传人'], 'ACC-1');
  assert.equal(fresh.calls.audit[0].action, 'submission.attachment.slot');
});

/* -------------------------------------------------------------------------- *
 * 我的附件（刷新恢复）
 * -------------------------------------------------------------------------- */

test('mine lists only own unbound live attachments plus config', async () => {
  const harness = createHarness({
    rows: [
      pendingRow({ id: 'ATT-MINE-1', status: ATTACHMENT_STATUS.uploaded, objectKey: 'submissions/ATT-MINE-1/photo.png', uploadedAt: '2026-10-05T10:00:00.000Z' }),
      pendingRow({ id: 'ATT-OTHERS', uploader: 'someone-else' }),
      pendingRow({ id: 'ATT-BOUND-1', submissionId: 'SUB-1', status: ATTACHMENT_STATUS.uploaded }),
      pendingRow({ id: 'ATT-DELETED-1', status: ATTACHMENT_STATUS.deleted }),
    ],
  });
  await attachmentRoutes(makeReq({ method: 'GET', url: apiUrl('/api/public/attachments/mine') }), {}, apiUrl('/api/public/attachments/mine'), harness.ctx);
  const payload = lastJson(harness.calls).payload;
  assert.equal(payload.attachments.length, 1);
  assert.equal(payload.attachments[0].id, 'ATT-MINE-1');
  assert.equal(payload.attachments[0].objectKey, undefined, 'portal view must not leak object keys');
  assert.equal(payload.config.maxFilesPerSubmission, MAX_FILES_PER_SUBMISSION);
  assert.equal(payload.config.storageConfigured, false);
});

/* -------------------------------------------------------------------------- *
 * 中转上传
 * -------------------------------------------------------------------------- */

test('upload enforces ownership and returns 404 for unknown slots', async () => {
  const harness = createHarness({ rows: [pendingRow({ id: 'ATT-FOREIGN', uploader: 'someone-else' })] });
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments/ATT-FOREIGN'), json: {} }),
    {}, apiUrl('/api/public/attachments/ATT-FOREIGN'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 403);
  assert.equal(lastJson(harness.calls).payload.code, 'attachment_not_owned');

  const missing = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments/ATT-NOPE'), json: {} }),
    {}, apiUrl('/api/public/attachments/ATT-NOPE'), missing.ctx,
  );
  assert.equal(lastJson(missing.calls).status, 404);
});

test('upload degrades to 503 when NJU Box storage is unconfigured', async () => {
  const harness = createHarness({ rows: [pendingRow()] });
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments/ATT-TEST-01'), json: {} }),
    {}, apiUrl('/api/public/attachments/ATT-TEST-01'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 503);
  assert.equal(lastJson(harness.calls).payload.code, 'njubox_not_configured');
  assert.equal(harness.calls.updated.length, 0, 'no row writes when degraded');
});

test('upload relays bytes to NJU Box and marks the row uploaded', async () => {
  const calls = [];
  const bytes = Buffer.from('attachment-bytes');
  const { body, headers } = await multipartBody('现场照片.png', 'image/png', bytes);
  const harness = createHarness({
    rows: [pendingRow()],
    ossConfig: { ...BOX_CONFIG, njuboxFetch: boxFetchMock(calls) },
  });
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments/ATT-TEST-01'), body, headers }),
    {}, apiUrl('/api/public/attachments/ATT-TEST-01'), harness.ctx,
  );
  const result = lastJson(harness.calls);
  assert.equal(result.status, 200);
  assert.equal(result.payload.attachment.status, ATTACHMENT_STATUS.uploaded);
  const patch = harness.calls.updated[0].patch;
  assert.equal(patch['上传状态'], ATTACHMENT_STATUS.uploaded);
  assert.equal(patch['对象Key'], '/内容投稿/ATT-TEST-01/现场照片.png');
  assert.equal(patch['Bucket'], 'repo-test-id');
  assert.equal(patch['存储提供商'], 'njubox');
  assert.equal(patch['大小'], String(bytes.length));
  assert.match(patch['校验和'], /^[0-9a-f]{64}$/);
  // 第一步：upload-link 的查询参数名必须是 p（不是 path——那是老 njubox.js 的 bug）。
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/api2\/repos\/repo-test-id\/upload-link\/\?p=%2F%E5%86%85%E5%AE%B9%E6%8A%95%E7%A8%BF$/);
  // 第二步：multipart POST 到一次性 seafhttp 直链。
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, 'https://box.nju.edu.cn/seafhttp/upload/abc');
  assert.equal(calls[1].hasBody, true);
  assert.equal(harness.calls.audit.at(-1).action, 'submission.attachment.upload');
});

test('upload rejects a second attempt on a bound slot', async () => {
  const harness = createHarness({ rows: [pendingRow({ submissionId: 'SUB-9', status: ATTACHMENT_STATUS.uploaded })] });
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments/ATT-TEST-01'), json: {} }),
    {}, apiUrl('/api/public/attachments/ATT-TEST-01'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 409);
  assert.equal(lastJson(harness.calls).payload.code, 'attachment_bound');
});

/* -------------------------------------------------------------------------- *
 * 删除
 * -------------------------------------------------------------------------- */

test('delete enforces ownership, binding and marks deleted', async () => {
  const calls = [];
  const harness = createHarness({
    rows: [
      pendingRow({ id: 'ATT-DEL-1', status: ATTACHMENT_STATUS.uploaded, objectKey: '/内容投稿/ATT-DEL-1/photo.png', bucket: 'repo-test-id' }),
      pendingRow({ id: 'ATT-DEL-BOUND', submissionId: 'SUB-1', status: ATTACHMENT_STATUS.uploaded, objectKey: 'x' }),
      pendingRow({ id: 'ATT-DEL-FOREIGN', uploader: 'someone-else' }),
    ],
    ossConfig: { ...BOX_CONFIG, njuboxFetch: boxFetchMock(calls) },
  });
  await attachmentRoutes(makeReq({ method: 'DELETE', url: apiUrl('/api/public/attachments/ATT-DEL-BOUND') }), {}, apiUrl('/api/public/attachments/ATT-DEL-BOUND'), harness.ctx);
  assert.equal(lastJson(harness.calls).status, 409);
  await attachmentRoutes(makeReq({ method: 'DELETE', url: apiUrl('/api/public/attachments/ATT-DEL-FOREIGN') }), {}, apiUrl('/api/public/attachments/ATT-DEL-FOREIGN'), harness.ctx);
  assert.equal(lastJson(harness.calls).status, 403);
  await attachmentRoutes(makeReq({ method: 'DELETE', url: apiUrl('/api/public/attachments/ATT-DEL-1') }), {}, apiUrl('/api/public/attachments/ATT-DEL-1'), harness.ctx);
  assert.equal(lastJson(harness.calls).status, 200);
  assert.equal(harness.calls.updated[0].patch['上传状态'], ATTACHMENT_STATUS.deleted);
  // 先删 Box 文件，再清空附件专属目录。
  assert.equal(calls[0].method, 'DELETE');
  assert.match(calls[0].url, /\/api2\/repos\/repo-test-id\/file\/\?p=%2F%E5%86%85%E5%AE%B9%E6%8A%95%E7%A8%BF%2FATT-DEL-1%2Fphoto\.png$/);
  assert.equal(calls[1].method, 'DELETE');
  assert.match(calls[1].url, /\/api2\/repos\/repo-test-id\/dir\/\?p=%2F%E5%86%85%E5%AE%B9%E6%8A%95%E7%A8%BF%2FATT-DEL-1$/);
  assert.equal(harness.calls.audit.at(-1).action, 'submission.attachment.delete');
});

test('delete succeeds without storage when the slot was never uploaded', async () => {
  const harness = createHarness({ rows: [pendingRow({ id: 'ATT-PENDING-ONLY' })] });
  await attachmentRoutes(makeReq({ method: 'DELETE', url: apiUrl('/api/public/attachments/ATT-PENDING-ONLY') }), {}, apiUrl('/api/public/attachments/ATT-PENDING-ONLY'), harness.ctx);
  assert.equal(lastJson(harness.calls).status, 200);
  assert.equal(harness.calls.updated[0].patch['上传状态'], ATTACHMENT_STATUS.deleted);
});

/* -------------------------------------------------------------------------- *
 * 投稿绑定校验
 * -------------------------------------------------------------------------- */

test('validateAttachmentBinding checks quota, ownership, binding and status', () => {
  const session = { username: 'tester' };
  const owns = { ownsBusinessRef: (s, value) => String(value) === 'ACC-1' };
  assert.throws(
    () => validateAttachmentBinding(session, { attachmentIds: Array.from({ length: MAX_FILES_PER_SUBMISSION + 1 }, (_, i) => `ATT-${i}`) }, [], owns),
    /最多绑定/,
  );
  assert.throws(
    () => validateAttachmentBinding(session, { attachmentIds: ['ATT-MISSING'] }, [], owns),
    /不存在/,
  );
  const rows = [
    pendingRow({ id: 'ATT-OK', status: ATTACHMENT_STATUS.uploaded }),
    pendingRow({ id: 'ATT-FOREIGN', uploader: 'someone-else' }),
    pendingRow({ id: 'ATT-BOUND', submissionId: 'SUB-8', status: ATTACHMENT_STATUS.uploaded }),
    pendingRow({ id: 'ATT-PENDING' }),
  ];
  assert.throws(() => validateAttachmentBinding(session, { attachmentIds: ['ATT-FOREIGN'] }, rows, owns), /不属于当前账号/);
  assert.throws(() => validateAttachmentBinding(session, { attachmentIds: ['ATT-BOUND'] }, rows, owns), /已绑定其他投稿/);
  assert.throws(() => validateAttachmentBinding(session, { attachmentIds: ['ATT-PENDING'] }, rows, owns), /尚未完成上传/);
  const bound = validateAttachmentBinding(session, { attachmentIds: ['ATT-OK', 'ATT-OK', ''] }, rows, owns);
  assert.equal(bound.length, 1);
  assert.equal(bound[0].record.id, 'ATT-OK');
  assert.deepEqual(validateAttachmentBinding(session, {}, rows, owns), []);
});

/* -------------------------------------------------------------------------- *
 * 审核端读取
 * -------------------------------------------------------------------------- */

test('outreach attachments endpoint filters by submission and returns Box links', async () => {
  const harness = createHarness({
    rows: [
      pendingRow({ id: 'ATT-A', submissionId: 'SUB-1', status: ATTACHMENT_STATUS.uploaded, objectKey: '/内容投稿/ATT-A/a.png', bucket: 'repo-test-id', uploadedAt: '2026-10-05T10:00:00.000Z' }),
      pendingRow({ id: 'ATT-B', submissionId: 'SUB-2', status: ATTACHMENT_STATUS.uploaded, objectKey: '/内容投稿/ATT-B/b.png' }),
      pendingRow({ id: 'ATT-C', submissionId: 'SUB-1', status: ATTACHMENT_STATUS.deleted, objectKey: '/内容投稿/ATT-C/c.png' }),
    ],
    ossConfig: { ...BOX_CONFIG, njuboxFetch: boxFetchMock() },
  });
  await outreachSubmissionAttachments(makeReq({ method: 'GET', url: apiUrl('/api/outreach/public-submissions/SUB-1/attachments') }), {}, harness.ctx, 'SUB-1');
  const payload = lastJson(harness.calls).payload;
  assert.equal(payload.attachments.length, 1);
  assert.equal(payload.attachments[0].id, 'ATT-A');
  assert.equal(payload.attachments[0].objectKey, '/内容投稿/ATT-A/a.png');
  // njubox 行 → 新鲜 seafhttp 临时直链（每次现取）。
  assert.equal(payload.links['ATT-A'], 'https://box.nju.edu.cn/seafhttp/files/abc');
  assert.equal(payload.storageConfigured, true);
  assert.equal(payload.provider, 'njubox');

  const offline = createHarness({ rows: harness.rows });
  await outreachSubmissionAttachments(makeReq({ method: 'GET', url: apiUrl('/api/outreach/public-submissions/SUB-1/attachments') }), {}, offline.ctx, 'SUB-1');
  const offlinePayload = lastJson(offline.calls).payload;
  assert.equal(offlinePayload.attachments.length, 1);
  assert.deepEqual(offlinePayload.links, {});
  assert.equal(offlinePayload.storageConfigured, false);
});
