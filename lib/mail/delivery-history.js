function unavailable() {
  return Object.assign(new Error('邮件发送记录暂不可确认，请稍后重试。'), {
    statusCode: 503,
    code: 'mail_history_unavailable',
  });
}

export async function hasDeliveredMail(client, key, {
  pageSize = 200,
  maxRows = 10_000,
  transport,
  expectedIntent,
} = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new TypeError('必须提供邮件幂等键。');
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || !Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new TypeError('读取上限必须是正整数。');
  }
  if (transport !== undefined && !['smtp', 'console'].includes(transport)) throw new TypeError('未知邮件通道。');
  if (!client || typeof client.listRows !== 'function') throw unavailable();

  let count = 0;
  for (let offset = 0; offset <= maxRows; offset += pageSize) {
    let rows;
    try { rows = await client.listRows('邮件发件记录表', '', '', false, offset, pageSize); }
    catch { throw unavailable(); }
    if (!Array.isArray(rows) || rows.readMeta?.truncated || rows.some(row => !row || typeof row !== 'object')) throw unavailable();
    count += rows.length;
    if (count > maxRows) throw unavailable();
    for (const row of rows) {
      if (String(row.幂等键 || '') !== key || String(row.状态 || '') !== '已发送') continue;
      if (transport && row.通道 !== transport) {
        if (!['smtp', 'console'].includes(row.通道)) throw unavailable();
        continue;
      }
      if (expectedIntent && (
        row.收件人 !== expectedIntent.to
        || row.主题 !== expectedIntent.subject.slice(0, 120)
        || row.类型 !== expectedIntent.kind
      )) throw unavailable();
      return true;
    }
    if (rows.length < pageSize) return false;
  }
  throw unavailable();
}
