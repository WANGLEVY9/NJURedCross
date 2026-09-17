/**
 * 活动运维闭环（Mainline B）端到端冒烟。
 *
 * 覆盖：匿名拦截、登录、通知预览（含缺字段 missing）、落库草稿、回填活动简介、
 * 发布状态流转、njubox 状态探测、附件引用落库、未配置 Token 时上传返回 503 且不落半条记录，
 * 以及收尾清理（活动 / 通知 / 附件全部回收，残留 0 行）。
 *
 * 用法：BASE_URL=http://localhost:3200 node scripts/smoke-events.mjs
 */

const BASE = (process.env.BASE_URL || 'http://localhost:3200').replace(/\/$/, '');
const SUFFIX = `EVT-${Date.now().toString(36).toUpperCase()}`;

const results = [];
function log(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
}

/** 带 cookie + csrf 的最小客户端，单账号一例。 */
class Client {
  constructor() {
    this.cookie = '';
    this.csrf = '';
  }

  async call(path, { method = 'GET', body, withCsrf = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    const mutating = !['GET', 'HEAD'].includes(method.toUpperCase());
    if (body !== undefined && typeof body !== 'string' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    if (mutating) headers['X-CSRF-Token'] = withCsrf ? this.csrf : '';
    let response;
    try {
      response = await fetch(`${BASE}${path}`, { method, headers, body, redirect: 'manual' });
    } catch (error) {
      return { status: 0, payload: { message: error.message }, headers: new Map() };
    }
    this.absorbCookies(response);
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: String(text).slice(0, 160) }; }
    return { status: response.status, payload: parsed, headers: response.headers };
  }

  absorbCookies(response) {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;
    const [pair, ...attributes] = setCookie.split(';');
    const cleared = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    this.cookie = cleared ? '' : pair;
  }

  async login(username, password) {
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      redirect: 'manual',
    });
    const payload = await response.json().catch(() => null);
    const setCookie = response.headers.get('set-cookie') || '';
    if (setCookie) this.cookie = setCookie.split(';')[0];
    this.csrf = payload?.csrfToken || '';
    return { status: response.status, payload };
  }

  /** 直接发送 multipart 上传请求（用于触发上传分支）。 */
  async upload(path, { fields, file }) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', file.blob, file.name);
    const headers = { Accept: 'application/json', Cookie: this.cookie, 'X-CSRF-Token': this.csrf };
    const response = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: form, redirect: 'manual' });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: String(text).slice(0, 160) }; }
    return { status: response.status, payload: parsed };
  }
}

/* -------------------------------------------------------------------------- */
console.log(`\n=== 活动运维闭环冒烟 @ ${BASE} (标记 ${SUFFIX}) ===\n`);

const ADMIN_USERNAME = process.env.SMOKE_ADMIN_USERNAME || 'admin1';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'njuredcross';

// 1. 匿名访问被拒（401）
const anon = await new Client().call('/api/event-notices');
log('未登录访问通知列表被拒（401）', anon.status === 401 && anon.payload?.code === 'login_required', `status=${anon.status} code=${anon.payload?.code}`);

// 2. 登录管理端
const admin = new Client();
const login = await admin.login(ADMIN_USERNAME, ADMIN_PASSWORD);
log('管理端账号登录成功', login.status === 200 && Boolean(login.payload?.csrfToken), `username=${ADMIN_USERNAME} status=${login.status}`);

// 3. 预览：完整字段
const fullBody = {
  name: `${SUFFIX} 急救培训`, category: '急救培训', campus: '仙林', location: '基础医学教学中心 101',
  startAt: '2026-10-10 14:00', endAt: '2026-10-10 16:00',
  registrationStart: '2026-09-20 09:00', registrationEnd: '2026-09-30 23:59',
  capacity: 30, content: '面向新生的心肺复苏与创伤救护培训。', contact: '红十字会值班台', qqGroup: '123456789',
};
const preview = await admin.call('/api/event-notices/preview', { method: 'POST', body: fullBody });
const previewBody = preview.payload?.notice?.body || '';
log(
  '预览返回正文含时间/地点/报名方式',
  preview.status === 200 && /活动时间/.test(previewBody) && /活动地点/.test(previewBody) && /报名方式/.test(previewBody) && (preview.payload?.notice?.missing || []).length === 0,
  `missing=${(preview.payload?.notice?.missing || []).join(',') || '无'}`,
);

// 3b. 缺字段时 missing 正确
const sparsePreview = await admin.call('/api/event-notices/preview', { method: 'POST', body: { name: `${SUFFIX} 缺字段` } });
const sparseMissing = sparsePreview.payload?.notice?.missing || [];
log(
  '缺字段时 missing 正确标出',
  sparsePreview.status === 200
    && sparseMissing.includes('活动地点') && sparseMissing.includes('活动时间')
    && sparseMissing.includes('报名时间') && sparseMissing.includes('报名名额')
    && sparseMissing.includes('联系人') && sparseMissing.includes('答疑群'),
  `missing=${sparseMissing.join(',')}`,
);

// 4. 建一个测试活动
const eventRes = await admin.call('/api/events', {
  method: 'POST',
  body: { title: `${SUFFIX} 测试活动`, type: '急救培训', campus: '仙林', location: '基础医学教学中心 101', capacity: 30, description: '初始简介', registrationStart: '2026-09-20 09:00', registrationEnd: '2026-09-30 23:59', startAt: '2026-10-10 14:00', endAt: '2026-10-10 16:00' },
});
const eventId = eventRes.payload?.event?.['活动ID'] || '';
log('测试活动创建成功', eventRes.status === 201 && Boolean(eventId), `eventId=${eventId}`);

// 5. 生成通知（草稿）
const genRes = await admin.call('/api/event-notices', { method: 'POST', body: { ...fullBody, eventId } });
const noticeId = genRes.payload?.notice?.noticeId || '';
log('生成报名通知落库且状态为草稿', genRes.status === 201 && genRes.payload?.notice?.status === '草稿' && Boolean(noticeId), `noticeId=${noticeId} status=${genRes.payload?.notice?.status}`);

// 6. 回填活动简介
const fillRes = await admin.call('/api/event-notices', { method: 'POST', body: { ...fullBody, eventId, fillDescription: true } });
const overview = await admin.call('/api/events/overview');
const evt = (overview.payload?.events || []).find((e) => e.eventId === eventId);
log(
  'fillDescription 回填活动简介',
  fillRes.status === 201 && evt && /报名方式/.test(evt.description || ''),
  `description 长度=${(evt?.description || '').length}`,
);

// 7. 发布通知 → 状态变更
const publishRes = await admin.call(`/api/event-notices/${encodeURIComponent(noticeId)}/publish`, { method: 'POST', body: {} });
log('发布通知后状态变为已发布', publishRes.status === 200 && publishRes.payload?.notice?.status === '已发布', `status=${publishRes.payload?.notice?.status}`);

// 8. njubox-status：未配置 Token，但匿名探测可达
const statusRes = await admin.call('/api/event-attachments/njubox-status');
const probe = statusRes.payload?.probe || {};
log(
  'njubox-status：configured=false 且匿名探测有结果',
  statusRes.status === 200 && statusRes.payload?.status?.configured === false && (probe.ok === true || Boolean(probe.ping) || Boolean(probe.serverInfo)),
  `configured=${statusRes.payload?.status?.configured} ping=${probe.ping} serverInfo=${probe.serverInfo ? '有' : '无'}`,
);

// 9a. 附件：引用模式落库一条
const refRes = await admin.call('/api/event-attachments', {
  method: 'POST',
  body: { eventId, purpose: '策划案', name: `${SUFFIX}-plan.pdf`, path: `/红十字会/活动策划案/${SUFFIX}-plan.pdf` },
});
const refId = refRes.payload?.attachment?.attachmentId || '';
log('附件引用模式落库一条', refRes.status === 201 && Boolean(refId), `attachmentId=${refId}`);

// 9b. 附件：上传模式在未配置 Token 时返回 503，且不产生半条记录
const listBefore = await admin.call(`/api/event-attachments?eventId=${encodeURIComponent(eventId)}`);
const beforeCount = (listBefore.payload?.attachments || []).length;
const uploadRes = await admin.upload('/api/event-attachments', {
  fields: { eventId, purpose: '策划案' },
  file: { name: 'plan.pdf', blob: new Blob(['dummy content for smoke test'], { type: 'application/pdf' }) },
});
const listAfter = await admin.call(`/api/event-attachments?eventId=${encodeURIComponent(eventId)}`);
const afterCount = (listAfter.payload?.attachments || []).length;
log(
  '未配置 Token 时上传返回 503（njubox_not_configured）且不落半条记录',
  uploadRes.status === 503 && uploadRes.payload?.code === 'njubox_not_configured' && afterCount === beforeCount,
  `status=${uploadRes.status} code=${uploadRes.payload?.code} 附件数 ${beforeCount}→${afterCount}`,
);

/* -------------------------------------------------------------------------- *
 * 收尾：回收本次产生的全部测试行（活动 / 通知 / 附件）
 * -------------------------------------------------------------------------- */
const cleanupTables = ['活动附件表', '活动通知表', '活动项目表'];
let removed = 0;
let expected = 0;
const residuals = [];
for (const table of cleanupTables) {
  const listed = await admin.call(`/api/rows?table=${encodeURIComponent(table)}`);
  const rows = listed.payload?.rows || [];
  const matched = rows.filter((row) => String(row['活动ID'] || '') === eventId);
  expected += matched.length;
  for (const row of matched) {
    const del = await admin.call(`/api/rows/${encodeURIComponent(row._id)}?table=${encodeURIComponent(table)}`, { method: 'DELETE' });
    if (del.status === 200) removed += 1;
    else residuals.push(`${table}/${row._id}`);
  }
}

// 复核：三张表都应 0 残留
let residualRows = 0;
for (const table of cleanupTables) {
  const listed = await admin.call(`/api/rows?table=${encodeURIComponent(table)}`);
  const rows = listed.payload?.rows || [];
  residualRows += rows.filter((row) => String(row['活动ID'] || '') === eventId).length;
}
log('回收全部测试行且残留 0 行', removed === expected && residualRows === 0, `删除 ${removed}/${expected}，残留 ${residualRows}`);

/* -------------------------------------------------------------------------- */
const passed = results.filter((r) => r.ok).length;
console.log(`\n=== 结果：${passed}/${results.length} 通过 · 测试活动 ${eventId} 残留 ${residualRows} 行 ===`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('失败项：');
  for (const item of failed) console.log(`  · ${item.step}${item.detail ? ` (${item.detail})` : ''}`);
  process.exitCode = 1;
}
