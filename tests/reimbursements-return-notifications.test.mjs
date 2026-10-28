import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { reimbursementTableFixture } from './helpers/reimbursement-table-fixture.js';
import { createReimbursementNotifier } from '../lib/reimbursements/notifications.js';
import { findReimbursementApplicant, findReimbursementReviewer } from '../lib/reimbursements/reviewer-source.js';
import { createMailIntent } from '../lib/mail/intent.js';

const owner = { id: 'synthetic-owner' }, initial = { id: 'synthetic-initial', financePermissions: ['initial'], financeRegion: 'initial-suzhou' },
  final = { id: 'synthetic-final', financePermissions: ['final', 'view'] };
const decision = (item, action = 'initial-return', note = '请补充付款截图，并核对金额。\n截图需完整清晰。') =>
  ({ action, note, revision: item.revision, stateVersion: item.stateVersion, materialsChecked: true });
async function setup() {
  const f = reimbursementTableFixture(); let clock = '2026-10-26T01:00:00Z';
  const service = () => f.makeService({ workflowVersion: 3, now: () => clock });
  await service().summaries.saveActivity(final, { id: 'synthetic-event', name: '合成活动', date: '2026-10-20', campus: '苏州',
    location: '合成地点', participantCount: 1, description: '退回邮件隔离验证' });
  const pdf = await PDFDocument.create(); pdf.addPage([300, 200]);
  const bytes = Buffer.from(await pdf.save());
  const prepare = () => service().preprocess(owner, [{ name: 'synthetic.pdf', bytes, kind: 'invoice', expenseItemId: 'a' }]);
  const { bundle } = await prepare();
  const input = { bundleId: bundle.id, name: '合成申请人', purpose: '活动材料', amount: '15.00', bankAccount: '0000000000000000',
    activityId: 'synthetic-event', expenseItems: [{ id: 'a', label: '合成物资', amount: '15.00' }], idempotencyKey: bundle.id };
  const { request } = await service().submit(owner, input);
  return { f, service, request, input, prepare, tick: value => { clock = value; } };
}
function notifier(service, send, getApplicant = async id => ({ id, email: 'applicant@example.invalid', emailVerified: true }), enabled = () => true) {
  return createReimbursementNotifier({ service, getApplicant, getReviewer: async () => null, send, enabled, origin: 'https://example.invalid' });
}

test('blank or whitespace return opinions change neither state nor notification queue', async () => {
  const { service, request } = await setup();
  for (const note of ['', ' \n\t ']) await assert.rejects(service().review(initial, request.id, decision(request, 'initial-return', note)), /退回原因/);
  const item = (await service().get(owner, request.id)).request;
  assert.equal(item.status, 'pending'); assert.equal(item.notificationStatuses.filter(job => job.stage === 'applicant-return').length, 0);
});

test('return and applicant mail survive Table recreation; opinion, link and recipient are correct, and delivery is idempotent', async () => {
  const { service, request } = await setup(), messages = [], recipients = [];
  const body = decision(request);
  const returned = (await service().review(initial, request.id, body)).request;
  assert.equal(returned.status, 'returned');
  assert.equal(returned.notificationStatuses.find(job => job.stage === 'applicant-return').status, 'queued');
  await assert.rejects(service().review(initial, request.id, body), { statusCode: 409 });
  const delivery = notifier(service(), async message => { messages.push(message); return { ok: true }; },
    async id => { recipients.push(id); return { id, email: 'applicant@example.invalid', emailVerified: true }; });
  await delivery.deliver(); await delivery.deliver();
  assert.deepEqual(recipients, [owner.id]); assert.equal(messages.length, 1);
  const message = messages[0];
  assert.equal(message.to, 'applicant@example.invalid'); assert.equal(message.kind, 'reimbursement-return');
  assert.match(message.subject, /退回补充/); assert.ok(message.text.includes(body.note));
  assert.ok(message.text.includes(request.code)); assert.match(message.text, /申请金额：15\.00 元/);
  assert.ok(message.text.includes(`https://example.invalid/materials/reimburse?request=${request.id}`));
  assert.equal(message.attachments, undefined); assert.equal(message.text.includes('0000000000000000'), false);
  assert.equal(createMailIntent(message, { secret: 'synthetic-mail-test-secret-00000000' }).kind, 'reimbursement-return');
  assert.equal((await service().get(owner, request.id)).request.notificationStatuses.find(job => job.stage === 'applicant-return').status, 'sent');
});

test('disabled mail, unverified contacts and a different account never send applicant details', async () => {
  for (const recipient of [null, { id: owner.id, email: 'test@example.invalid', emailVerified: false },
    { id: 'synthetic-stranger', email: 'test@example.invalid', emailVerified: true }]) {
    const { service, request } = await setup(); await service().review(initial, request.id, decision(request));
    const messages = []; let enabled = false;
    const delivery = notifier(service(), async message => { messages.push(message); return { ok: true }; }, async () => recipient, () => enabled);
    await delivery.deliver(); assert.equal(messages.length, 0);
    enabled = true; await delivery.deliver(); assert.equal(messages.length, 0);
    assert.equal((await service().get(owner, request.id)).request.notificationStatuses.find(job => job.stage === 'applicant-return').status, 'waiting-configuration');
  }
});

test('resubmission cancels the old return email; another return creates a distinct task with the new opinion', async () => {
  const { service, request, input, prepare } = await setup();
  await service().review(initial, request.id, decision(request));
  const { bundle } = await prepare();
  const next = (await service().submit(owner, { ...input, bundleId: bundle.id, idempotencyKey: bundle.id }, request.id)).request;
  const messages = [], delivery = notifier(service(), async message => { messages.push(message); return { ok: true }; });
  await delivery.deliver(); assert.equal(messages.length, 0);
  assert.equal((await service().get(owner, request.id)).request.notificationStatuses.find(job => job.stage === 'applicant-return').status, 'cancelled');
  await service().review(initial, next.id, decision(next, 'initial-return', '第二版仍缺订单截图'));
  await notifier(service(), async message => { messages.push(message); return { ok: true }; }).deliver();
  assert.equal(messages.length, 1); assert.match(messages[0].text, /第二版仍缺订单截图/);
  assert.match(messages[0].text, /第 2 版/);
});

test('safe retries reuse delivery identity; a changed email or unknown send result stops automatic sending', async () => {
  const { service, request, tick } = await setup(); await service().review(initial, request.id, decision(request));
  const messages = []; let email = 'applicant@example.invalid';
  const delivery = notifier(service(), async message => { messages.push(message); return { ok: false, retryable: true, code: 'synthetic-before-send' }; },
    async id => ({ id, email, emailVerified: true }));
  await delivery.deliver(); tick('2026-10-26T01:02:00Z'); await delivery.deliver();
  assert.equal(messages.length, 2); assert.equal(messages[0].idempotencyKey, messages[1].idempotencyKey);
  email = 'changed@example.invalid'; tick('2026-10-26T01:10:00Z'); await delivery.deliver();
  assert.equal(messages.length, 2);
  assert.equal((await service().get(owner, request.id)).request.notificationStatuses.find(job => job.stage === 'applicant-return').status, 'needs-attention');
  const second = await setup(); await second.service().review(initial, second.request.id, decision(second.request));
  const uncertain = notifier(second.service(), async () => { throw Error('synthetic unknown delivery'); });
  await uncertain.deliver();
  assert.equal((await second.service().get(owner, second.request.id)).request.notificationStatuses.find(job => job.stage === 'applicant-return').status, 'needs-attention');
});

test('final returning to initial does not create an applicant return email', async () => {
  const { service, request } = await setup();
  const sent = (await service().review(initial, request.id, decision(request, 'initial-approve', ''))).request;
  const back = (await service().review(final, sent.id, decision(sent, 'final-return', '交初审复核'))).request;
  assert.equal(back.status, 'initial_returned'); assert.equal(back.notificationStatuses.some(job => job.stage === 'applicant-return'), false);
});

test('applicant contacts use an exact active verified account projection without credential fields', async () => {
  let sql, rows = [{ '账号ID': owner.id, '真实姓名': '合成申请人', '邮箱': 'applicant@example.invalid', '邮箱已验证': '已验证', '状态': '启用' }];
  const client = { query: async value => { sql = value; return rows; } };
  assert.deepEqual(await findReimbursementApplicant(client, owner.id), { id: owner.id, email: 'applicant@example.invalid', emailVerified: true });
  assert.match(sql, /WHERE `账号ID` = 'synthetic-owner' LIMIT 2/); assert.doesNotMatch(sql, /密码|Token|SELECT \*/);
  assert.equal(await findReimbursementReviewer(client, owner.id, '其他姓名'), null);
  assert.equal(await findReimbursementReviewer(client, owner.id), null);
  rows[0]['邮箱已验证'] = '未验证'; assert.equal(await findReimbursementApplicant(client, owner.id), null);
  rows[0]['邮箱已验证'] = '已验证'; rows[0]['状态'] = '停用'; assert.equal(await findReimbursementApplicant(client, owner.id), null);
  rows = [rows[0], rows[0]]; assert.equal(await findReimbursementApplicant(client, owner.id), null);
  assert.equal(await findReimbursementApplicant(client, "bad'id"), null);
});
