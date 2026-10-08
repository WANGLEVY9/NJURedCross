import { Base } from 'seatable-api';
import { randomUUID } from 'node:crypto';
import {
  buildAuditEvidenceQuery,
  readAuditCandidates,
} from '../lib/audit/audit-query.js';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

try {
  if (process.argv.slice(2).length !== 0) {
    throw new Error('不支持额外参数。');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('本检查仅用于测试环境。');
  }

  const server = process.env.SEATABLE_SERVER_URL?.trim();
  const token = process.env.SEATABLE_API_TOKEN?.trim();
  const expectedUuid = process.env.SEATABLE_BUSINESS_BASE_UUID?.trim();

  if (
    !server
    || !token
    || !expectedUuid
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
      .test(expectedUuid)
  ) {
    throw new Error('业务测试 Base 配置不完整或 UUID 格式不正确。');
  }

  installSeaTableTransport();

  await withRequestBudget(async () => {
    const base = new Base({ server, APIToken: token });
    await base.auth();

    if (base.dtableUuid !== expectedUuid) {
      throw new Error('业务 Base UUID 不匹配。');
    }

    const sample = await base.query(
      'SELECT `_id`, `审计ID` FROM `操作审计表` ORDER BY `_id` LIMIT 1',
    );

    if (
      !Array.isArray(sample)
      || sample.length > 1
      || sample.readMeta?.truncated
      || sample.some(row => (
        !row
        || typeof row._id !== 'string'
        || !row._id
        || typeof row['审计ID'] !== 'string'
      ))
    ) {
      throw new Error('审计样本格式不正确。');
    }

    const probe = `AUD-QUERY-PROBE-${randomUUID()}`;
    const empty = await readAuditCandidates(base, probe);

    if (!Array.isArray(empty) || empty.length !== 0) {
      throw new Error('空候选查询不符合预期。');
    }

    let sampleLookupVerified = false;
    let duplicateSampleDetected = false;

    if (
      sample.length === 1
      && buildAuditEvidenceQuery(sample[0]['审计ID']) !== null
    ) {
      const candidates = await readAuditCandidates(
        base,
        sample[0]['审计ID'],
      );

      if (!candidates.some(row => row._id === sample[0]._id)) {
        throw new Error('筛选查询未返回预期样本。');
      }

      sampleLookupVerified = true;
      duplicateSampleDetected = candidates.length > 1;
    }

    console.log(JSON.stringify({
      mode: 'read-only',
      writes: 0,
      baseUuidMatches: true,
      sampleRows: sample.length,
      emptyQueryVerified: true,
      sampleLookupVerified,
      duplicateSampleDetected,
    }, null, 2));

    if (duplicateSampleDetected) process.exitCode = 1;
  });
} catch {
  console.error(
    '审计 SQL 只读检查未完成。请核对业务测试 Base、UUID、表结构和查询接口；本脚本不写入审计记录，也不修改本地凭据。',
  );
  process.exitCode = 1;
}