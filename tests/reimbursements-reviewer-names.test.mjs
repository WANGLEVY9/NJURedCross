import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFinanceReviewerBindings, FINANCE_REVIEWERS } from '../lib/reimbursements/review-routing.js';
import { productionReimbursementActor } from '../lib/reimbursements/production-api.js';
const accounts = () => Object.entries(FINANCE_REVIEWERS).map(([key, realName]) => ({ accountId: `synthetic-${key}`, realName, status: '启用' }));
test('fixed reviewer names resolve from existing server accounts without manually configured IDs', () => {
  const rows = accounts(), bindings = resolveFinanceReviewerBindings(rows);
  assert.deepEqual(bindings, { 'initial-suzhou': 'synthetic-initial-suzhou', 'initial-other': 'synthetic-initial-other', final: 'synthetic-final' });
  assert.deepEqual(productionReimbursementActor(rows[0], bindings).financePermissions, ['initial']);
  assert.equal(productionReimbursementActor(rows[0], bindings).financeRegion, 'initial-suzhou');
  assert.deepEqual(productionReimbursementActor(rows[2], bindings).financePermissions, ['final', 'view']);
  assert.deepEqual(productionReimbursementActor({ accountId: 'synthetic-caller', realName: '顾语涵' }, bindings).financePermissions, []);
});
test('missing, inactive, duplicate-name and conflicting reviewer accounts never receive ambiguous authority', () => {
  const rows = accounts(); rows[0].status = '停用';
  assert.equal(resolveFinanceReviewerBindings(rows)['initial-suzhou'], '');
  assert.equal(resolveFinanceReviewerBindings(rows.slice(0, 2)).final, '');
  rows[0].status = '启用'; rows.push({ ...rows[0], accountId: 'synthetic-duplicate' });
  assert.equal(resolveFinanceReviewerBindings(rows)['initial-suzhou'], '');
  assert.equal(resolveFinanceReviewerBindings(accounts(), { final: 'synthetic-wrong-person' }).final, '');
  const shared = accounts(); shared[1].accountId = shared[0].accountId;
  const result = resolveFinanceReviewerBindings(shared); assert.equal(result['initial-suzhou'], ''); assert.equal(result['initial-other'], '');
});
