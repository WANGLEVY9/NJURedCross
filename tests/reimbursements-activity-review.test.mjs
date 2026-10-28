import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createLocalReimbursementService } from '../lib/reimbursements/local-service.js';
import { processPdfs } from '../lib/reimbursements/pdf.js';
import { generateItemPackets } from '../lib/reimbursements/item-packets.js';
import { renderTestSummary } from './helpers/reimbursement-summary-renderer.js';
import { createReimbursementNotifier } from '../lib/reimbursements/notifications.js';
import { productionFinancePermissions } from '../lib/reimbursements/production-api.js';
import { mailAttachments } from '../lib/mail/attachments.js';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { createReimbursementState } from '../lib/reimbursements/state.js';

const owner = { id: 'synthetic-owner' }, initial = { id: 'synthetic-li', financePermissions: ['initial'], financeRegion: 'initial-suzhou' },
  other = { id: 'synthetic-zou', financePermissions: ['initial'], financeRegion: 'initial-other' },
  final = { id: 'synthetic-gu', financePermissions: ['final', 'view'] };
const activityInput = activity => Object.fromEntries(Object.entries(activity).filter(([key]) => ['id', 'name', 'date', 'campus', 'location', 'participantCount', 'description', 'unitName', 'fundAccount', 'revision'].includes(key)));
const decision = (item, action, note = '') => ({ action, revision: item.revision, stateVersion: item.stateVersion, materialsChecked: true, note });
async function evidence(width = 300) {
  const pdf = await PDFDocument.create(); pdf.addPage([width, 200]);
  return Buffer.from(await pdf.save());
}
async function setup(options = {}) {
  let clock = '2026-10-22T01:00:00Z';
  const service = createLocalReimbursementService({ processFiles: processPdfs, generatePackets: generateItemPackets,
    generateSummary: renderTestSummary, requireDistinctReviewers: true, now: () => clock, ...options });
  await service.summaries.saveActivity(final, { id: 'activity', name: '合成讲座', date: '2026-10-20', campus: '苏州',
    location: '合成地点', participantCount: 20, description: '合成活动内容' });
  async function submit(amount = '15.00', width = 300) {
    const { bundle } = await service.preprocess(owner, [{ name: 'evidence.pdf', bytes: await evidence(width), kind: 'invoice', expenseItemId: 'item' }]);
    const input = { bundleId: bundle.id, name: '合成申请人', purpose: '合成支出', amount, bankAccount: '0000000000000000', activityId: 'activity',
      expenseItems: [{ id: 'item', label: `条目${width}`, amount }], idempotencyKey: bundle.id };
    return { input, request: (await service.submit(owner, input)).request };
  }
  return { service, submit, tick: value => { clock = value; } };
}
const summaryBody = (activity, items) => ({ activityId: activity.id, activityRevision: activity.revision,
  selections: items.map(item => ({ requestId: item.id, revision: item.revision, stateVersion: item.stateVersion })),
  form: { handlerName: '合成经办', handlerPhone: 'SYNTHETIC', fillDate: '2026-10-22' }, idempotencyKey: crypto.randomUUID() });
const approveSummary = item => ({ action: 'approve', stateVersion: item.stateVersion, materialsChecked: true, scopeConfirmed: true });

test('activity campus controls the assigned initial reviewer; caller input and personal campus cannot bypass it', async () => {
  const { service, submit } = await setup(); const { request } = await submit();
  assert.equal(request.workflowVersion, 3); assert.equal(request.initialAssignment.name, '李婉荣');
  assert.equal(service.list(other, true).requests.length, 0);
  assert.throws(() => service.get(other, request.id, true), { statusCode: 404 });
  await assert.rejects(async () => service.review(other, request.id, decision(request, 'initial-approve')));
  // Submission already prepared the item derivatives; no generation button is needed.
  assert.ok(service.materialPackets.list(initial, request.id).packets);
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  assert.equal(sent.status, 'final_pending');
  await assert.rejects(service.review(final, request.id, decision(sent, 'final-approve')), /活动终审/);
  const activity = service.summaries.listActivities(final).activities[0];
  await service.summaries.saveActivity(final, { ...activityInput(activity), campus: '仙林' });
  const second = (await submit()).request; assert.equal(second.initialAssignment.name, '邹孟窈');
  await service.review(other, second.id, decision(second, 'initial-return', '补充凭证'));
});

test('a single activity draft sorts form rows and evidence together, previews the cover plus all evidence, then approves as one batch', async () => {
  const { service, submit } = await setup();
  const a = (await submit('15.00', 300)).request, b = (await submit('20.00', 350)).request;
  const sent = await Promise.all([a, b].map(async item => (await service.review(initial, item.id, decision(item, 'initial-approve'))).request));
  const body = summaryBody(service.summaries.listActivities(final).activities[0], sent);
  body.itemOrder = [...sent].reverse().map(item => ({ requestId: item.id, itemId: 'item' }));
  const { summary } = await service.summaries.create(final, body);
  assert.equal(summary.status, 'draft'); assert.equal(summary.totalCents, 3500);
  assert.deepEqual(summary.rows.map(item => item.label), ['条目350', '条目300']);
  assert.deepEqual(summary.materialGroups.map(item => item.requestId), [b.id, a.id]);
  assert.equal(service.get(owner, a.id).request.paymentStatus, 'not-ready');
  const pdf = await PDFDocument.load(service.summaries.download(final, summary.id, 'packet').bytes);
  assert.equal(pdf.getPageCount(), summary.formPages + 2);
  assert.deepEqual(pdf.getPages().slice(summary.formPages).map(page => page.getWidth()), [350, 300]);
  assert.equal((await service.summaries.create(final, body)).duplicate, true);
  await assert.rejects(async () => service.summaries.review(initial, summary.id, approveSummary(summary)), { statusCode: 403 });
  await assert.rejects(service.summaries.review(final, summary.id, { ...approveSummary(summary), scopeConfirmed: false }), /申请范围/);
  const approved = await service.summaries.review(final, summary.id, approveSummary(summary));
  assert.equal(approved.summary.status, 'approved');
  for (const request of sent) {
    const result = service.get(owner, request.id).request;
    assert.equal(result.finalReview.summaryId, summary.id); assert.equal(result.paymentStatus, 'pending');
  }
  await assert.rejects(service.summaries.review(final, summary.id, approveSummary(summary)), { statusCode: 409 });
});

test('missing campus, forged/incomplete ordering, and stale draft versions fail closed; return remains routed through initial', async () => {
  const { service, submit } = await setup(); const { request, input } = await submit();
  let activity = service.summaries.listActivities(final).activities[0];
  await service.summaries.saveActivity(final, { ...activityInput(activity), campus: '' });
  await assert.rejects(submit(), /举办校区/);
  activity = service.summaries.listActivities(final).activities[0];
  await service.summaries.saveActivity(final, { ...activityInput(activity), campus: '苏州' });
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  const body = summaryBody(service.summaries.listActivities(final).activities[0], [sent]);
  await assert.rejects(service.summaries.create(final, { ...body, itemOrder: [] }), /完整包含/);
  await assert.rejects(service.summaries.create(final, { ...body, itemOrder: [{ requestId: sent.id, itemId: 'forged' }] }), /不属于/);
  const { summary } = await service.summaries.create(final, body);
  await service.summaries.review(final, summary.id, { action: 'return', stateVersion: summary.stateVersion, note: '重新核对订单' });
  const returned = service.get(owner, sent.id).request; assert.equal(returned.status, 'initial_returned');
  await assert.rejects(service.submit(owner, input, sent.id), { statusCode: 409 });
  const resent = (await service.review(initial, sent.id, decision(returned, 'initial-approve'))).request;
  assert.equal(resent.status, 'final_pending');
  await assert.rejects(service.summaries.review(final, summary.id, approveSummary(summary)), { statusCode: 409 });
  const second = await service.summaries.create(final, summaryBody(service.summaries.listActivities(final).activities[0], [resent]));
  await submit('5.00', 310);
  await assert.rejects(service.summaries.review(final, second.summary.id, approveSummary(second.summary)), /申请范围已变化/);
});

test('notification tasks persist with business state, use PDF attachments, cancel old stages, and do not send while disabled', async () => {
  const { service, submit, tick } = await setup(); const { request } = await submit(); const messages = [];
  let enabled = false, ready = true;
  const notifier = createReimbursementNotifier({ service, origin: 'https://example.invalid', enabled: () => enabled,
    getReviewer: async key => ready ? { id: key, email: `${key}@example.invalid`, emailVerified: true } : null,
    send: async message => { messages.push(message); mailAttachments(message); return { ok: true }; } });
  await notifier.deliver(); assert.equal(messages.length, 0);
  enabled = true; ready = false; await notifier.deliver(); assert.equal(messages.length, 0);
  assert.equal(service.get(owner, request.id).request.notificationStatuses[0].status, 'waiting-configuration');
  ready = true; tick('2026-10-22T01:02:00Z'); await notifier.deliver(); await notifier.deliver();
  assert.equal(messages.length, 1); assert.equal(messages[0].to, 'initial-suzhou@example.invalid');
  assert.equal(messages[0].attachments[0].content.subarray(0, 5).toString(), '%PDF-');
  const sent = (await service.review(initial, request.id, decision(request, 'initial-approve'))).request;
  await notifier.deliver(); assert.equal(messages.length, 2); assert.equal(messages[1].to, 'final@example.invalid');
  assert.match(messages[1].text, /summary\?activity=/); assert.equal(messages[1].attachments, undefined);
  const back = (await service.review(final, sent.id, decision(sent, 'final-return', '补充核查'))).request;
  const repeated = (await service.review(initial, back.id, decision(back, 'initial-approve'))).request;
  await service.review(final, repeated.id, decision(repeated, 'final-return', '暂缓'));
  await notifier.deliver(); assert.equal(messages.length, 2);
  assert.ok(service.get(owner, request.id).request.notificationStatuses.some(job => job.status === 'cancelled'));
});

test('production reviewer bindings use trusted unique account IDs, never the name supplied by a caller', () => {
  const bindings = { 'initial-suzhou': 'li', 'initial-other': 'zou', final: 'gu' };
  assert.deepEqual(productionFinancePermissions({ accountId: 'li', realName: '任意名字' }, bindings), ['initial']);
  assert.deepEqual(productionFinancePermissions({ accountId: 'fake', realName: '李婉荣' }, bindings), []);
  assert.deepEqual(productionFinancePermissions({ accountId: 'gu' }, bindings), ['final', 'view']);
  assert.deepEqual(productionFinancePermissions({ accountId: 'li' }, { ...bindings, final: 'li' }), []);
  assert.deepEqual(productionFinancePermissions({ role: 'super_admin', accountId: 'super' }, bindings), ['view', 'payment']);
});

test('safe pre-send failures retry with the same identity; unknown delivery stops, changed recipients never receive old jobs', async () => {
  const { service, submit, tick } = await setup(); const { request } = await submit();
  let outcome = { ok: false, retryable: true, code: 'mail_history_unavailable' }, recipient = 'li@example.invalid';
  const messages = [], notifier = createReimbursementNotifier({ service, origin: 'https://example.invalid', enabled: () => true,
    getReviewer: async () => ({ id: 'li', email: recipient, emailVerified: true }),
    send: async message => { messages.push(message); return outcome; } });
  await notifier.deliver(); assert.equal(messages.length, 1);
  tick('2026-10-22T01:02:00Z'); outcome = { ok: false, code: 'mail_delivery_unknown' };
  await notifier.deliver(); assert.equal(messages.length, 2); assert.equal(messages[0].idempotencyKey, messages[1].idempotencyKey);
  assert.equal(messages[0].text, messages[1].text); assert.deepEqual(messages[0].attachments, messages[1].attachments);
  tick('2026-10-22T02:00:00Z'); await notifier.deliver(); assert.equal(messages.length, 2);
  assert.equal(service.get(owner, request.id).request.notificationStatuses[0].status, 'needs-attention');
  const second = (await submit('5.00', 340)).request;
  outcome = { ok: false, retryable: true }; await notifier.deliver();
  const count = messages.length; recipient = 'changed@example.invalid'; tick('2026-10-22T03:00:00Z');
  await notifier.deliver(); assert.equal(messages.length, count);
  assert.equal(service.get(owner, second.id).request.notificationStatuses[0].status, 'needs-attention');
});

test('oversized merged PDFs become an explicit protected-link notification, without attaching bank data', async () => {
  const state = createReimbursementState(), { service, submit } = await setup({ state }), { request } = await submit();
  state.bundles.get(request.bundle.id).merged = Buffer.alloc(11 * 1024 ** 2);
  let message;
  const notifier = createReimbursementNotifier({ service, origin: 'https://example.invalid', enabled: () => true,
    getReviewer: async () => ({ id: 'li', email: 'li@example.invalid', emailVerified: true }),
    send: async value => { message = value; return { ok: true }; } });
  await notifier.deliver(); assert.equal(message.attachments, undefined);
  assert.match(message.text, /超出邮件附件限制/); assert.match(message.text, /console\/reimbursements\?request=/);
  assert.ok(!message.text.includes(request.bankAccount));
});

test('Table recreation retains activity draft, order, notification queue and final review; Box remains replaceable with an isolated fake', async () => {
  const fixture = reimbursementTableFixture();
  const { service, submit } = await setup();
  // The persistent service uses only synthetic clients, with the same new workflow.
  const persistent = fixture.makeService({ workflowVersion: 3, generateSummary: renderTestSummary });
  const activity = service.summaries.listActivities(final).activities[0];
  const { revision: _revision, ...newActivity } = activityInput(activity);
  await persistent.summaries.saveActivity(final, newActivity);
  const { input } = await submit(); const { bundle } = await persistent.preprocess(owner, [{ name: 'proof.pdf', bytes: await evidence(), kind: 'invoice', expenseItemId: 'item' }]);
  const { request } = await persistent.submit(owner, { ...input, bundleId: bundle.id });
  const sent = (await persistent.review(initial, request.id, decision(request, 'initial-approve'))).request;
  const generated = await persistent.summaries.create(final, summaryBody(activity, [sent]));
  const reopened = fixture.makeService({ workflowVersion: 3, generateSummary: renderTestSummary });
  assert.equal((await reopened.notifications.pending()).length, 2);
  const result = await reopened.summaries.review(final, generated.summary.id, approveSummary(generated.summary));
  assert.equal(result.summary.status, 'approved');
  assert.equal((await fixture.makeService({ workflowVersion: 3 }).get(owner, request.id)).request.finalReview.summaryId, generated.summary.id);
  assert.ok((await reopened.summaries.download(final, generated.summary.id, 'packet')).bytes.length);
});

test('mail attachment extension is restricted to reimbursement initial PDFs and preserves the existing Excel policy', async () => {
  const file = { filename: '材料.pdf', content: await evidence(), contentType: 'application/pdf' };
  assert.equal(mailAttachments({ kind: 'reimbursement-initial', attachments: [file] }).length, 1);
  assert.throws(() => mailAttachments({ kind: 'reimbursement-final', attachments: [file] }));
  assert.throws(() => mailAttachments({ kind: 'reimbursement-initial', attachments: [{ ...file, filename: '../材料.pdf' }] }));
  assert.throws(() => mailAttachments({ kind: 'reimbursement-initial', attachments: [{ ...file, content: Buffer.from('fake') }] }));
  assert.throws(() => mailAttachments({ kind: 'reimbursement-initial', attachments: [{ ...file, content: Buffer.alloc(11 * 1024 ** 2) }] }));
});
