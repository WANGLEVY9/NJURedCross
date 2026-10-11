import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { createPreviewServer } from '../scripts/preview-materials.mjs';
import { materialFilename } from '../public/app/shared/reimbursement-files.js';

const owner = { id: 'file-owner' }, reviewer = { id: 'file-reviewer', canReview: true };
const processing = async files => ({ merged: Buffer.from('merged'), pageCount: files.length,
  sources: files.map((file, index) => ({ name: file.name, pages: 1, startPage: index + 1, endPage: index + 1, checks: [] })) });
async function setup() {
  const service = createLocalReimbursementService({ processFiles: processing, analyzePage: async () => ({ buyer: { state: 'unknown' }, seal: { state: 'not-detected', regions: [] } }) });
  await service.summaries.saveActivity(reviewer, { id: 'file-event', name: '材料测试活动' });
  return service;
}
const submitBody = bundle => ({ name: '测试申请人', amount: '87.00', purpose: '活动材料', activityId: 'file-event',
  bundleId: bundle.id, idempotencyKey: bundle.id, expenseItems: [{ id: 'pens', category: '办公用品', label: '修正带', amount: '87.00' }] });
const files = [{ name: '原始发票.pdf', kind: 'invoice', expenseItemId: 'pens', bytes: Buffer.from('unchanged-original') },
  { name: '原始清单.pdf', kind: 'supporting', expenseItemId: '', bytes: Buffer.from('unchanged-supporting') }];

test('classified upload binds each invoice to its expense and renames downloads without altering bytes or provenance', async () => {
  const service = await setup(), { bundle } = await service.preprocess(owner, files);
  const { request } = await service.submit(owner, submitBody(bundle));
  assert.deepEqual(request.bundle.sources.map(source => source.kind), ['invoice', 'supporting']);
  assert.equal(request.bundle.originalUrls[0].name, '测试申请人-办公用品-修正带-发票.pdf');
  assert.equal(request.bundle.originalUrls[0].originalName, '原始发票.pdf');
  assert.equal(request.bundle.originalUrls[1].name, '测试申请人-其他-活动材料-补充材料-01.pdf');
  assert.deepEqual(service.attachment(owner, bundle.id, 0).bytes, files[0].bytes);
  assert.equal(request.bundle.sources[0].sha256, bundle.sources[0].sha256);
  const replay = await service.submit(owner, submitBody(bundle));
  assert.equal(replay.duplicate, true); assert.equal(service.list(owner).requests.length, 1);
  const extra = [...files, { ...files[0], name: '第二张发票.pdf' }, { ...files[1], name: '第二份清单.pdf' }];
  const next = (await service.preprocess(owner, extra)).bundle;
  const renamed = (await service.submit(owner, submitBody(next))).request.bundle.originalUrls;
  assert.ok(renamed[1].name.endsWith('-补充材料-01.pdf'));
  assert.ok(renamed[3].name.endsWith('-补充材料-02.pdf'));
  await assert.rejects(service.analyze(owner, bundle.id, 2), /补充材料/);
  assert.equal(service.get(owner, request.id).request.bundle.analyses.length, 0);
});

test('invalid expense binding and duplicate expense IDs cannot submit or change existing history', async () => {
  const service = await setup(), { bundle } = await service.preprocess(owner, files);
  const input = submitBody(bundle);
  await assert.rejects(service.submit(owner, { ...input, expenseItems: [{ ...input.expenseItems[0], id: 'other' }] }), /支出项目/);
  await assert.rejects(service.submit(owner, { ...input, amount: '174.00', expenseItems: [input.expenseItems[0], input.expenseItems[0]] }), /不能重复/);
  assert.equal(service.list(owner).requests.length, 0);
  assert.equal((await service.submit(owner, input)).request.status, 'pending');
});

test('invoice names use their expense label without ordinals; supporting names retain ordinals and path sanitation', () => {
  const first = materialFilename({ name: '../测试', category: '办公/用品', label: '修正带:一批', kind: 'invoice', index: 0 });
  assert.equal(/[<>:"/\\|?*\x00-\x1f]/.test(first), false);
  assert.equal(first, materialFilename({ name: '../测试', category: '办公/用品', label: '修正带:一批', kind: 'invoice', index: 1 }));
  assert.notEqual(first, materialFilename({ name: '../测试', category: '办公/用品', label: '便利贴', kind: 'invoice', index: 1 }));
  assert.notEqual(materialFilename({ name: '测试', kind: 'supporting', index: 0 }), materialFilename({ name: '测试', kind: 'supporting', index: 1 }));
});

test('HTTP classified files enforce combined limits and manifest order while legacy uploads remain accepted', async t => {
  const server = await createPreviewServer({ seedSyncFailure: false }); server.listen(0); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`, root = `${origin}/api/preview/reimbursements`;
  const auth = await fetch(`${origin}/api/auth/session`), session = await auth.json();
  const headers = { Cookie: auth.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken };
  const doc = await PDFDocument.create(); doc.addPage(); const bytes = await doc.save();
  const form = new FormData();
  form.append('invoices', new Blob([bytes], { type: 'application/pdf' }), 'invoice.pdf');
  form.append('supporting', new Blob([bytes], { type: 'application/pdf' }), 'receipt.pdf');
  form.append('manifest', JSON.stringify([{ expenseItemId: 'pens' }, { expenseItemId: '' }]));
  assert.equal((await fetch(`${root}/bundles`, { method: 'POST', body: form })).status, 403);
  const response = await fetch(`${root}/bundles`, { method: 'POST', headers, body: form });
  assert.equal(response.status, 201); const { bundle } = await response.json();
  assert.deepEqual(bundle.sources.map(source => [source.kind, source.expenseItemId]), [['invoice', 'pens'], ['supporting', '']]);
  form.set('manifest', '[]');
  assert.equal((await fetch(`${root}/bundles`, { method: 'POST', headers, body: form })).status, 400);
  const excess = new FormData();
  for (let index = 0; index < 11; index++) excess.append(index % 2 ? 'supporting' : 'invoices', new Blob([bytes]), `${index}.pdf`);
  assert.equal((await fetch(`${root}/bundles`, { method: 'POST', headers, body: excess })).status, 400);
  const legacy = new FormData(); legacy.append('files', new Blob([bytes]), 'legacy.pdf');
  const old = await fetch(`${root}/bundles`, { method: 'POST', headers, body: legacy });
  assert.equal(old.status, 201); assert.equal((await old.json()).bundle.sources[0].kind, 'legacy');
});
