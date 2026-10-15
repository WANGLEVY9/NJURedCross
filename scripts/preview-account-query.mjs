import { Base } from 'seatable-api';
import { randomUUID } from 'node:crypto';
import {
  buildAccountLookupQuery,
  readAccountCandidates,
} from '../lib/identity/account-query.js';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

try {
  if (process.argv.slice(2).length !== 0) {
    throw new Error('不支持额外参数。');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('本检查仅用于测试环境。');
  }

  const token = process.env.SEATABLE_IDENTITY_API_TOKEN?.trim();
  const expectedUuid = process.env.SEATABLE_IDENTITY_BASE_UUID?.trim();
  const server = process.env.SEATABLE_SERVER_URL?.trim();

  if (!token || !expectedUuid || !server) {
    throw new Error('身份测试 Base 配置不完整。');
  }

  installSeaTableTransport();

  await withRequestBudget(async () => {
    const base = new Base({
      server,
      APIToken: token,
    });

    await base.auth();

    if (base.dtableUuid !== expectedUuid) {
      throw new Error('身份 Base UUID 不匹配。');
    }

    const sample = await base.query(
      'SELECT `_id`, `登录名`, `邮箱`, `学号`, `真实姓名` '
      + 'FROM `平台账号表` ORDER BY `_id` LIMIT 1',
    );

    if (
      !Array.isArray(sample) || sample.length > 1
      || sample.some(row => (
        !row || typeof row._id !== 'string' || !row._id
      ))
    ) {
      throw new Error('SDK 行标识格式不正确。');
    }

    const probe = `QUERY-PROBE-${randomUUID()}`;
    const empty = await readAccountCandidates(
      base,
      probe,
      { aliases: true },
    );

    if (!Array.isArray(empty) || empty.length !== 0) {
      throw new Error('空候选检查不符合预期。');
    }

    let sampleLookupVerified = false;

    if (sample.length === 1) {
      const row = sample[0];
      const key = String(row['登录名'] || row['邮箱'] || '').trim();

      if (key && buildAccountLookupQuery(key) !== null) {
        const candidates = await readAccountCandidates(base, key);

        if (!candidates.some(candidate => candidate._id === row._id)) {
          throw new Error('筛选查询未返回预期样本。');
        }

        sampleLookupVerified = true;
      }
    }

    console.log(JSON.stringify({
      mode: 'read-only',
      writes: 0,
      baseUuidMatches: true,
      sampleRows: sample.length,
      aliasQueryVerified: true,
      sampleLookupVerified,
    }, null, 2));
  });
} catch {
  console.error(
    '账号 SQL 只读检查未完成。请核对身份测试 Base、表结构、UUID 和查询接口；本脚本不修改账号。',
  );
  process.exitCode = 1;
}