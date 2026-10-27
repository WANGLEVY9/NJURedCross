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

/** 活动项目表名 + 默认候选：v3.2 起投稿附件的活动名要过这张表的白名单。 */
const PROJECT_TABLE = '活动项目表';
const DEFAULT_PROJECT_ROWS = Object.freeze([
  { _id: 'proj-1', 活动名称: '急救培训 AED', 中心: '博爱中心', 状态: '进行中' },
  { _id: 'proj-2', 活动名称: '无偿献血进校园', 中心: '生命中心', 状态: '进行中' },
]);

function createHarness({ rows = [], ossConfig = {}, session = { username: 'tester', csrf: 'csrf-token' }, projectRows = DEFAULT_PROJECT_ROWS } = {}) {
  const calls = { json: [], audit: [], updated: [] };
  const client = {
    // 按表分派：附件行与活动项目行是两套数据，不能混用。
    listRows: async (table) => (table === PROJECT_TABLE ? projectRows : rows).map((row) => ({ ...row })),
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
    tables: { attachment: '投稿附件表', submission: '宣传投稿表', project: PROJECT_TABLE },
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

// 合成 NJU Box 配置：v3 资料库级令牌（Bearer + via-repo-token）。njuboxFetch 注入 mock。
const BOX_CONFIG = {
  njuboxToken: 'main-token-test',
  njuboxPicksToken: 'picks-token-test',
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
    if (href.includes('/download-link/')) return new Response(JSON.stringify(fileLink), { status: 200 });
    // 目录探测统一返回「已存在」，避免 mock 里把父目录重复建成 "(1)"。
    if (href.includes('/dir/?') && entry.method === 'GET') return new Response(JSON.stringify({ dirent_list: [{ type: 'dir', name: '博爱中心' }] }), { status: 200 });
    if (href.includes('/seafhttp/upload/')) return new Response('file-id-123', { status: 200 });
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
    // v3.1：槽位必须带部门与活动，落点 = /<部门>/<活动名>/<附件ID>/<文件名>。
    center: '博爱中心',
    activity: '急救培训 AED',
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
  // 类型/大小校验先于归位校验：即便没带部门与活动，超大图片仍应报 413。
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'big.png', mimeType: 'image/png', size: 21 * 1024 * 1024 } }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 413);
  const video = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'ok.mp4', mimeType: 'video/mp4', size: 150 * 1024 * 1024, center: '博爱中心', activity: '急救培训 AED' } }),
    {}, apiUrl('/api/public/attachments'), video.ctx,
  );
  assert.equal(lastJson(video.calls).status, 201);
});

test('slot creation requires department and activity (v3.1 归位前置校验)', async () => {
  const base = { filename: '现场照片.jpg', mimeType: 'image/jpeg', size: 2048 };
  const noCenter = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { ...base, activity: '急救培训 AED' } }),
    {}, apiUrl('/api/public/attachments'), noCenter.ctx,
  );
  assert.equal(lastJson(noCenter.calls).status, 400);
  assert.equal(lastJson(noCenter.calls).payload.code, 'attachment_center_invalid');
  assert.equal(noCenter.rows.length, 0, '校验失败不得落行');

  // 部门必须是白名单五中心之一。
  const badCenter = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { ...base, center: '第九中心', activity: '急救培训 AED' } }),
    {}, apiUrl('/api/public/attachments'), badCenter.ctx,
  );
  assert.equal(lastJson(badCenter.calls).payload.code, 'attachment_center_invalid');

  const noActivity = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { ...base, center: '博爱中心' } }),
    {}, apiUrl('/api/public/attachments'), noActivity.ctx,
  );
  assert.equal(lastJson(noActivity.calls).status, 400);
  assert.equal(lastJson(noActivity.calls).payload.code, 'attachment_activity_missing');
  assert.equal(noActivity.rows.length, 0);
});

test('slot creation rejects activities outside the project catalog (v3.2 禁手填)', async () => {
  const base = { filename: '现场照片.jpg', mimeType: 'image/jpeg', size: 2048 };
  // 活动项目表里没有的名字 → 400，且不得落行。
  const unknown = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { ...base, center: '博爱中心', activity: '临时新活动' } }),
    {}, apiUrl('/api/public/attachments'), unknown.ctx,
  );
  assert.equal(lastJson(unknown.calls).status, 400);
  assert.equal(lastJson(unknown.calls).payload.code, 'attachment_activity_not_allowed');
  assert.equal(unknown.rows.length, 0, '白名单未命中不得落行');

  // 活动存在但归属另一个部门 → 同样拒（跨部门错配）。
  const crossCenter = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { ...base, center: '博爱中心', activity: '无偿献血进校园' } }),
    {}, apiUrl('/api/public/attachments'), crossCenter.ctx,
  );
  assert.equal(lastJson(crossCenter.calls).payload.code, 'attachment_activity_not_allowed');
  assert.equal(crossCenter.rows.length, 0);

  // 命中该部门候选 → 201。
  const hit = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { ...base, center: '生命中心', activity: '无偿献血进校园' } }),
    {}, apiUrl('/api/public/attachments'), hit.ctx,
  );
  assert.equal(lastJson(hit.calls).status, 201);
  assert.equal(hit.rows.length, 1);
});

test('slot creation writes a pending row with audit and quota cap', async () => {
  const harness = createHarness({
    rows: Array.from({ length: MAX_UNBOUND_PER_ACCOUNT }, (_, index) => pendingRow({ id: `ATT-FULL-${index}` })),
  });
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: 'one-more.png', mimeType: 'image/png', size: 10, center: '博爱中心' } }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  assert.equal(lastJson(harness.calls).status, 429);
  assert.equal(lastJson(harness.calls).payload.code, 'attachment_quota_exceeded');

  const fresh = createHarness();
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl('/api/public/attachments'), json: { filename: '现场照片.jpg', mimeType: 'image/jpeg', size: 2048, center: '博爱中心', activity: '急救培训 AED' } }),
    {}, apiUrl('/api/public/attachments'), fresh.ctx,
  );
  const created = lastJson(fresh.calls);
  assert.equal(created.status, 201);
  assert.equal(created.payload.attachment.status, ATTACHMENT_STATUS.pending);
  assert.equal(fresh.rows[0]['上传状态'], ATTACHMENT_STATUS.pending);
  assert.equal(fresh.rows[0]['上传人'], 'ACC-1');
  // v3.1：部门与活动随槽位落库，上传时据此拼 Box 路径。
  assert.equal(fresh.rows[0]['中心'], '博爱中心');
  assert.equal(fresh.rows[0]['活动名'], '急救培训 AED');
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
  // v3.1 落点：/<部门>/<活动名>/<附件ID>/<文件名>
  assert.equal(patch['对象Key'], '/博爱中心/急救培训 AED/ATT-TEST-01/现场照片.png');
  assert.equal(patch['Bucket'], 'main');
  assert.equal(patch['存储提供商'], 'njubox');
  assert.equal(patch['大小'], String(bytes.length));
  assert.match(patch['校验和'], /^[0-9a-f]{64}$/);
  // v3：所有 API 请求走 via-repo-token 前缀；上传直链本身是 seafhttp，不算 API 调用。
  const apiCalls = calls.filter((call) => !call.url.includes('/seafhttp/'));
  assert.ok(apiCalls.every((call) => call.url.includes('/api/v2.1/via-repo-token/')), 'via-repo-token prefix');
  assert.ok(calls.every((call) => !call.url.includes('/api2/repos/')), 'no legacy /api2/repos');
  const uploadLinkCall = calls.find((call) => call.url.includes('/upload-link/'));
  assert.equal(uploadLinkCall.method, 'GET');
  assert.equal(
    new URL(uploadLinkCall.url).searchParams.get('path'),
    '/博爱中心/急救培训 AED/ATT-TEST-01',
    '上传直链的目录参数 = 部门/活动/附件ID',
  );
  // multipart POST 到一次性 seafhttp 直链。
  const postCall = calls.find((call) => call.method === 'POST' && call.url.includes('/seafhttp/upload/'));
  assert.ok(postCall, 'must POST to the seafhttp upload link');
  assert.equal(postCall.hasBody, true);
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
      pendingRow({ id: 'ATT-DEL-1', status: ATTACHMENT_STATUS.uploaded, objectKey: '/博爱中心/急救培训 AED/ATT-DEL-1/photo.png', bucket: 'main' }),
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
  // 先删 Box 文件，再清空附件专属目录（重算落点一致时才清）。
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(new URL(calls[0].url).searchParams.get('path'), '/博爱中心/急救培训 AED/ATT-DEL-1/photo.png');
  assert.equal(calls[1].method, 'DELETE');
  assert.equal(new URL(calls[1].url).searchParams.get('path'), '/博爱中心/急救培训 AED/ATT-DEL-1');
  assert.equal(harness.calls.audit.at(-1).action, 'submission.attachment.delete');
});

test('delete keeps the activity directory when the row has no department/activity', async () => {
  // 历史行（v3.1 前）缺「中心/活动名」→ 重算落点不匹配 → 只删文件、绝不误删活动目录。
  const calls = [];
  const harness = createHarness({
    rows: [pendingRow({ id: 'ATT-OLD-1', center: '', activity: '', status: ATTACHMENT_STATUS.uploaded, objectKey: '/内容投稿/文字稿件/ATT-OLD-1/photo.png', bucket: 'main' })],
    ossConfig: { ...BOX_CONFIG, njuboxFetch: boxFetchMock(calls) },
  });
  await attachmentRoutes(makeReq({ method: 'DELETE', url: apiUrl('/api/public/attachments/ATT-OLD-1') }), {}, apiUrl('/api/public/attachments/ATT-OLD-1'), harness.ctx);
  assert.equal(lastJson(harness.calls).status, 200);
  const dirDeletes = calls.filter((call) => call.method === 'DELETE' && call.url.includes('/dir/?'));
  assert.equal(dirDeletes.length, 0, '落点不一致时不得删目录');
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

/* -------------------------------------------------------------------------- *
 * 文创设计通道（2026-10-27）：不选部门/活动，统一落 /文创设计工作组
 * -------------------------------------------------------------------------- */

test('track=design：不传部门/活动也能申请槽位，落点固定 /文创设计工作组/<附件ID>', async () => {
  const harness = createHarness({ ossConfig: { ...BOX_CONFIG, njuboxFetch: boxFetchMock() } });
  await attachmentRoutes(
    makeReq({
      method: 'POST',
      url: apiUrl('/api/public/attachments'),
      json: { filename: 'poster.png', mimeType: 'image/png', size: 2048, track: 'design' },
    }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  const { status, payload } = lastJson(harness.calls);
  assert.equal(status, 201, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  // 记录里不带部门/活动（文创没有这两项）。
  const row = harness.rows[harness.rows.length - 1];
  assert.equal(row['中心'] ?? '', '', '文创不写部门');
  assert.equal(row['活动名'] ?? '', '', '文创不写活动');
  // 上传后对象 Key 落在文创设计工作组下。
  const id = payload.attachment.id;
  const upload = await multipartBody('poster.png', 'image/png', Buffer.from('89504e47', 'hex'));
  await attachmentRoutes(
    makeReq({ method: 'POST', url: apiUrl(`/api/public/attachments/${id}`), headers: upload.headers, body: upload.body }),
    {}, apiUrl(`/api/public/attachments/${id}`), harness.ctx,
  );
  const uploaded = lastJson(harness.calls).payload;
  assert.equal(uploaded.ok, true);
  assert.match(uploaded.attachment.status, /已上传|uploaded/);
  const updated = harness.calls.updated.find((entry) => entry.patch && entry.patch['对象Key']);
  assert.ok(updated, 'expected object key patch');
  assert.ok(String(updated.patch['对象Key']).startsWith(`/文创设计工作组/${id}/`), updated.patch['对象Key']);
});

test('track=article（默认）：仍然强制部门 + 活动', async () => {
  const harness = createHarness();
  await attachmentRoutes(
    makeReq({
      method: 'POST',
      url: apiUrl('/api/public/attachments'),
      json: { filename: 'a.png', mimeType: 'image/png', size: 10 },
    }),
    {}, apiUrl('/api/public/attachments'), harness.ctx,
  );
  const { status, payload } = lastJson(harness.calls);
  assert.equal(status, 400);
  assert.equal(payload.code, 'attachment_center_invalid');
});
