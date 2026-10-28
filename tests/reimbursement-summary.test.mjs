import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createLocalReimbursementService, amountCents } from '../lib/reimbursements/local-service.js';
import { chineseAmount, normalizeExpenses, checkedDate } from '../lib/reimbursements/summary-contract.js';
import { generateSummaryPdf } from '../lib/reimbursements/summary-pdf.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';

const admin = { id: 'synthetic-materials-admin', canReview: true }, owner = { id: 'owner' };
const activityBody = { id: 'event-1', name: '测试活动', date: '2026-10-07', location: '演示地点', participantCount: 35,
  description: '合成活动内容', unitName: '南京大学红十字会', fundAccount: 'TEST-FUND' };
const fakeFiles = async files => ({ merged: Buffer.from('merged'), pageCount: files.length,
  sources: files.map((file, i) => ({ name: file.name, startPage: i + 1, endPage: i + 1, pages: 1, checks: [] })) });
const fakeSummary = async () => ({ formPdf: Buffer.from('form'), packetPdf: Buffer.from('packet'), formPages: 1, packetPages: 3, attachments: [] });
function service(options = {}) { return createLocalReimbursementService({ workflowVersion: 1, processFiles: fakeFiles, generateSummary: fakeSummary, ...options }); }
async function setup(options) { const s = service(options); await s.summaries.saveActivity(admin, activityBody); return s; }
async function claim(s, { amount = '1.00', label = '便利贴', note = '互动', actor = owner, activityId = 'event-1', approved = true, bytes } = {}) {
  const { bundle } = await s.preprocess(actor, [{ name: 'test.pdf', bytes: bytes || Buffer.from(`evidence-${Math.random()}`) }]);
  const { request } = await s.submit(actor, { name: '合成申请人', purpose: '测试用途', amount, bundleId: bundle.id, idempotencyKey: bundle.id,
    ...(activityId ? { activityId, expenseItems: [{ label, amount, note }] } : {}) });
  if (!approved) return request;
  return (await s.review(admin, request.id, { action: 'approve', revision: request.revision, note: '人工核对合成材料',
    materialsChecked: true })).request;
}
function input(s, claims) {
  return { activityId: 'event-1', activityRevision: s.summaries.listActivities(admin).activities[0].revision,
    selections: claims.map(r => ({ requestId: r.id, revision: r.revision })), mergeSameItems: true,
    form: { handlerName: '演示经办人', handlerPhone: 'TEST-PHONE', fillDate: '2026-10-07' }, idempotencyKey: 'batch-1' };
}

test('integration accepts old payloads, exact item sums and paired event/items; rejects mismatches and invalid dates', () => {
  assert.deepEqual(normalizeExpenses({ amount: '1.00' }, amountCents), { activityId: null, expenseItems: [] });
  assert.equal(normalizeExpenses({ amount: '0.30', activityId: 'a', expenseItems: [{ label: 'a', amount: '0.10' }, { label: 'b', amount: '0.20' }] }, amountCents).expenseItems[1].amountCents, 20);
  for (const body of [{ amount: '1.00', activityId: 'a' }, { amount: '1.00', expenseItems: [] },
    { amount: '1.00', activityId: 'a', expenseItems: [{ label: 'a', amount: '0.99' }] },
    { amount: '1.00', activityId: 'a', expenseItems: [{ label: 'a', amount: '1.00', paid: true }] }]) assert.throws(() => normalizeExpenses(body, amountCents));
  assert.equal(checkedDate('2024-02-29', '日期'), '2024-02-29');
  for (const date of ['2026-02-29', '2026-04-31', '2026-1-01']) assert.throws(() => checkedDate(date, '日期'));
});
test('Chinese totals preserve zero gaps, cents, integer zero and large groups', () => {
  for (const [amount, expected] of [[0, '零元整'], [1, '零元壹分'], [105, '壹元零伍分'], [28062, '贰佰捌拾元陆角贰分'],
    [100100, '壹仟零壹元整'], [1000100, '壹万零壹元整'], [10000000100, '壹亿零壹元整'], [10001000100, '壹亿零壹万零壹元整']]) assert.equal(chineseAmount(amount), expected);
  assert.throws(() => chineseAmount(1.1));
});
test('activity write is reviewer only and version guarded; applicant list omits finance fields', async () => {
  const s = await setup();
  assert.throws(() => s.summaries.saveActivity(owner, activityBody), /权限/);
  const publicEvent = s.summaries.listActivities(owner).activities[0];
  assert.deepEqual(Object.keys(publicEvent).sort(), ['campus', 'category', 'date', 'id', 'location', 'name']);
  const grouped = await s.summaries.saveActivity(admin, { ...activityBody, revision: 1, campus: '苏州', category: '生命中心' });
  assert.equal(s.summaries.listActivities(owner).activities[0].campus, '苏州');
  assert.equal(s.summaries.listActivities(owner).activities[0].category, '生命中心');
  await assert.rejects(s.summaries.saveActivity(admin, activityBody), /版本/);
  await s.summaries.saveActivity(admin, { ...activityBody, revision: grouped.activity.revision, name: '新名称' });
  assert.equal(s.summaries.listActivities(admin).activities[0].revision, 3);
});
test('multi-person aggregation groups only matching label AND note, retaining all source versions', async () => {
  const s = await setup(), a = await claim(s, { amount: '120.00' }), b = await claim(s, { amount: '80.00', actor: { id: 'other' } }), c = await claim(s, { amount: '0.01', note: '其他用途' });
  const preview = s.summaries.preview(admin, input(s, [a, b, c])).summary;
  assert.equal(preview.totalCents, 20001); assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].amountCents, 20000); assert.equal(preview.rows[0].origins.length, 2);
  assert.deepEqual(preview.rows[0].origins.map(r => [r.requestId, r.revision]), [[a.id, 1], [b.id, 1]]);
  assert.equal(s.summaries.preview(admin, { ...input(s, [a, b]), mergeSameItems: false }).summary.rows.length, 2);
});
test('eligibility excludes old/pending/cross-event/stale/duplicate selections and requires complete metadata', async () => {
  const s = await setup(), a = await claim(s), pending = await claim(s, { approved: false }), old = await claim(s, { activityId: null });
  assert.equal(old.summaryEligibility.eligible, false);
  for (const body of [input(s, [pending]), input(s, [old]), input(s, [a, a]), { ...input(s, [a]), activityRevision: 0 },
    { ...input(s, [a]), selections: [{ requestId: a.id, revision: 0 }] }]) assert.throws(() => s.summaries.preview(admin, body));
  await s.summaries.saveActivity(admin, { ...activityBody, id: 'event-2' });
  const another = await claim(s, { activityId: 'event-2' });
  assert.throws(() => s.summaries.preview(admin, input(s, [another])), /同一个活动/);
  await s.summaries.saveActivity(admin, { ...activityBody, revision: 1, description: '' });
  assert.throws(() => s.summaries.preview(admin, input(s, [a])), /补齐/);
});
test('same bytes across claims trigger manual warning and confirmation, without altering evidence', async () => {
  const s = await setup(), bytes = Buffer.from('same-evidence'), a = await claim(s, { bytes }), b = await claim(s, { bytes });
  const body = input(s, [a, b]);
  assert.equal(s.summaries.preview(admin, body).summary.duplicateMaterials.length, 1);
  await assert.rejects(s.summaries.create(admin, body), /重复材料/);
  const result = await s.summaries.create(admin, { ...body, duplicateMaterialsConfirmed: true });
  assert.equal(result.summary.duplicateMaterialsConfirmed, true);
  assert.deepEqual(s.attachment(owner, a.bundleId, 0).bytes, bytes);
});
test('concurrent generation serializes claims; replay is idempotent, new batches exclude already aggregated requests', async () => {
  let calls = 0;
  const s = await setup({ generateSummary: async (...args) => { calls++; return fakeSummary(...args); } }), a = await claim(s), body = input(s, [a]);
  const results = await Promise.all([s.summaries.create(admin, body), s.summaries.create(admin, body)]);
  assert.equal(calls, 1); assert.equal(results[0].summary.id, results[1].summary.id); assert.equal(results[1].duplicate, true);
  assert.equal(s.list(admin, true).requests[0].summaryEligibility.eligible, false);
  await assert.rejects(s.summaries.create(admin, { ...body, idempotencyKey: 'batch-2' }), /已纳入/);
  await assert.rejects(s.summaries.create(admin, { ...body, mergeSameItems: false }), /同一操作/);
  const b = await claim(s);
  assert.equal((await s.summaries.create(admin, { ...input(s, [b]), idempotencyKey: 'supplement' })).summary.selections.length, 1);
  assert.equal(s.get(owner, a.id).request.status, 'approved');
});
test('generation failure leaves no partial history or claim and permits retry; financial downloads are reviewer only', async () => {
  let calls = 0;
  const s = await setup({ generateSummary: async () => { if (!calls++) throw new Error('generation failed'); return fakeSummary(); } }), a = await claim(s), body = input(s, [a]);
  await assert.rejects(s.summaries.create(admin, body), /generation failed/);
  assert.equal(s.summaries.list(admin).summaries.length, 0); assert.equal(s.summaries.preview(admin, body).summary.totalCents, 100);
  const result = await s.summaries.create(admin, body);
  for (const action of [() => s.summaries.preview(owner, body), () => s.summaries.list(owner), () => s.summaries.download(owner, result.summary.id, 'form')]) assert.throws(action, /权限/);
  const download = s.summaries.download(admin, result.summary.id, 'form'); download.bytes.fill(0);
  assert.equal(s.summaries.download(admin, result.summary.id, 'form').bytes.toString(), 'form');
});
test('summary enforces selection count and reserves a page for its form', async () => {
  const s = await setup({ processFiles: async files => ({ ...await fakeFiles(files), pageCount: 300 }) }), a = await claim(s);
  assert.throws(() => s.summaries.preview(admin, input(s, [a])), /300 页/);
  assert.throws(() => s.summaries.preview(admin, input(s, Array.from({ length: 21 }, () => a))), /20/);
});

const fontPath = process.env.REIMBURSEMENT_FONT_PATH || (process.platform === 'win32' ? 'C:/Windows/Fonts/simfang.ttf' : '');
test('actual PDF embeds Chinese, continues long tables, preserves source geometry and maps exact attachment pages', { skip: !existsSync(fontPath) }, async () => {
  const s = await setup(), a = await claim(s), summary = { ...s.summaries.preview(admin, input(s, [a])).summary, code: 'HZ-TEST' };
  const source = await PDFDocument.create(); source.addPage([200, 300]); source.addPage([400, 500]); const bytes = Buffer.from(await source.save()), original = Buffer.from(bytes);
  summary.rows = Array.from({ length: 40 }, (_, index) => ({ label: `项目 ${index + 1}`, amountCents: 100, note: '用于活动材料。'.repeat(15) }));
  summary.totalCents = 4000; summary.amountUpper = chineseAmount(4000);
  const files = await generateSummaryPdf(summary, [{ requestId: a.id, bytes, sources: [{ name: 'evidence.pdf', sha256: 'test', startPage: 1, endPage: 2 }] }], { fontPath });
  const loading = getDocument({ data: new Uint8Array(files.formPdf), useSystemFonts: true });
  const report = await loading.promise;
  try {
    const text = (await (await report.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
    assert.ok(text.includes('4301011309001041656'), 'the report must use the unified fund account');
    assert.ok(!text.includes('TEST-FUND'), 'activity metadata must not override the report account');
    assert.equal(summary.activity.fundAccount, 'TEST-FUND', 'generating a report must preserve activity metadata');
  } finally { await loading.destroy(); }
  assert.ok(files.formPages > 1); assert.equal(files.packetPages, files.formPages + 2);
  const packet = await PDFDocument.load(files.packetPdf);
  assert.deepEqual(packet.getPages().slice(-2).map(p => p.getSize()), [{ width: 200, height: 300 }, { width: 400, height: 500 }]);
  assert.equal(files.attachments[0].startPage, files.formPages + 1); assert.equal(files.attachments[0].sources[0].endPage, files.packetPages);
  assert.deepEqual(bytes, original);
  await assert.rejects(generateSummaryPdf(summary, [], { fontPath: '/missing-font' }), /字体/);
  const longMetadata = { ...summary, activity: { ...summary.activity, name: '活'.repeat(100), unitName: '单'.repeat(100), fundAccount: 'A'.repeat(80),
    location: '地'.repeat(100), description: '目'.repeat(1000) }, form: { ...summary.form, handlerName: '经'.repeat(50), handlerPhone: 'P'.repeat(50) }, rows: [{ label: '采购', amountCents: 100, note: '用途\r\n说明' }] };
  const metadataFiles = await generateSummaryPdf(longMetadata, [], { fontPath });
  assert.ok(metadataFiles.formPages >= 2, 'long metadata must continue rather than run outside the page');
});

test('HTTP summary routes require session and CSRF, return private PDF and replay the same generation', async t => {
  const s = await setup(), a = await claim(s), body = input(s, [a]), server = await createPreviewServer({ seedSyncFailure: false, reimbursementService: s });
  server.listen(0); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, root = `${origin}/api/preview/reimbursements`;
  const auth = await fetch(`${origin}/api/auth/session`), session = await auth.json(), cookie = auth.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken };
  // This loopback preview automatically opens a simulated session; logout below checks its denial path.
  assert.equal((await fetch(`${root}/summaries`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await fetch(`${root}/activities`, { headers })).status, 200);
  const created = await fetch(`${root}/summaries`, { method: 'POST', headers, body: JSON.stringify(body) }); assert.equal(created.status, 201);
  const result = await created.json(), pdf = await fetch(`${origin}${result.summary.formUrl}`, { headers });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.match(pdf.headers.get('cache-control'), /no-store/);
  assert.equal(await pdf.text(), 'form');
  assert.equal((await fetch(`${root}/summaries`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 200);
  assert.equal((await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(`${root}/summaries`, { headers })).status, 401);
});
