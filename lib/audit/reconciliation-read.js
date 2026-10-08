import { readPagedRows } from '../http/paged-rows.js';
import { readAuditCandidates } from './audit-query.js';

const contentFields = [
  '操作人', '角色', '动作', '对象', '结果', 'IP', '备注',
];

function unavailable() {
  return Object.assign(
    new Error('远端审计记录无法完整核对，已停止处理。'),
    { code: 'audit_reconciliation_unavailable', statusCode: 503 },
  );
}

function conflict() {
  return Object.assign(
    new Error('远端审计记录重复或内容不一致，需人工核对。'),
    { code: 'audit_reconciliation_conflict', statusCode: 409 },
  );
}

/** Read authoritative audit rows without writing or retrying an uncertain append. */
export async function findAuditEvidence(client, expected) {
  if (
    !expected
    || typeof expected['审计ID'] !== 'string'
    || !expected['审计ID']
    || typeof expected['时间'] !== 'string'
    || !Number.isFinite(Date.parse(expected['时间']))
    || contentFields.some(field => typeof expected[field] !== 'string')
  ) {
    throw unavailable();
  }

  const candidates = await readAuditCandidates(client, expected['审计ID']);

  const rows = candidates === null
    ? await readPagedRows(client, '操作审计表', {
      pageSize: 500,
      maxRows: 100000,
      requireComplete: true,
    })
    : candidates;

  const matches = rows.filter(row => row['审计ID'] === expected['审计ID']);
  if (matches.length > 1) throw conflict();
  if (matches.length === 0) {
    return { found: false, matched: false };
  }

  const actual = matches[0];
  if (
    typeof actual._id !== 'string'
    || !actual._id
    || typeof actual['时间'] !== 'string'
    || !Number.isFinite(Date.parse(actual['时间']))
  ) {
    throw unavailable();
  }

  if (
    Date.parse(actual['时间']) !== Date.parse(expected['时间'])
    || contentFields.some(field => actual[field] !== expected[field])
  ) {
    throw conflict();
  }

  return {
    found: true,
    matched: true,
    rowId: actual._id,
  };
}