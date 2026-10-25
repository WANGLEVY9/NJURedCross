import { createHash } from 'node:crypto';

export const FRIEND_BLESSING_COLUMNS = Object.freeze(['挚友邮箱', '挚友生日', '计划投递日期']);
export function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}
function validBirthday(value) {
  if (!/^\d{2}-\d{2}$/.test(value)) return false;
  const [month, day] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(2024, month - 1, day));
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}
export function friendBlessingTarget(body, now = new Date()) {
  const email = typeof body.friendEmail === 'string' ? body.friendEmail.trim().toLowerCase() : '';
  const birthday = typeof body.friendBirthday === 'string' ? body.friendBirthday.trim() : '';
  if (email.length > 254 || !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)) {
    throw Object.assign(new Error('请填写有效的挚友邮箱。'), { statusCode: 400 });
  }
  if (!validBirthday(birthday)) throw Object.assign(new Error('请选择有效的挚友生日（月、日）。'), { statusCode: 400 });
  const today = shanghaiDate(now);
  let year = Number(today.slice(0, 4));
  for (; year < Number(today.slice(0, 4)) + 9; year++) {
    const date = `${year}-${birthday}`;
    if (date < today) continue;
    const probe = new Date(`${date}T00:00:00Z`);
    if (probe.toISOString().slice(0, 10) === date) return { friendEmail: email, friendBirthday: birthday, scheduledDate: date };
  }
  throw Object.assign(new Error('挚友生日无效。'), { statusCode: 400 });
}
export function friendSchemaReady(metadata) {
  const table = metadata?.tables?.find(table => table.name === '温暖连接投稿表');
  return FRIEND_BLESSING_COLUMNS.every(name => table?.columns?.some(column => column.name === name && column.type === 'text'));
}
export async function assertFriendSchema(client) {
  if (!friendSchemaReady(await client.getMetadata())) throw Object.assign(new Error('写给挚友尚未开放，请联系管理员补齐表结构。'), { statusCode: 503, code: 'friend_blessing_schema_not_ready' });
}

/** Invoked under the birthday delivery lock. Only approved, live letters may send. */
export async function deliverFriendBlessings({ client, submissions, library, deliveries, eligibleAuthor, send, now = new Date(), identifier, onDelivered }) {
  const today = shanghaiDate(now);
  const summary = { delivered: 0, pending: 0, expired: 0 };
  for (const row of submissions) {
    if (row['项目'] !== 'birthday' || row['投递方式'] !== '写给挚友' || row['状态'] !== '已通过') continue;
    const id = String(row['投稿ID'] || '');
    const approved = library.find(item => item['投稿ID'] === id && item['分类'] === '写给挚友' && item['状态'] === '在库');
    if (!id || !approved || approved['内容'] !== row['内容'] || approved['署名昵称'] !== row['署名昵称']) continue;
    const targetDate = String(row['计划投递日期'] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate > today) continue;
    const prior = deliveries.filter(item => item['投稿ID'] === id && item['来源'] === '写给挚友');
    const completed = prior.find(item => item['邮件状态'] === '已发送');
    if (completed) { await onDelivered?.(row, completed); continue; }
    if (targetDate < today) { summary.expired++; continue; }
    if (!await eligibleAuthor(row['提交人'])) continue;
    let target;
    try { target = friendBlessingTarget({ friendEmail: row['挚友邮箱'], friendBirthday: row['挚友生日'] }, now); }
    catch { continue; }
    if (target.scheduledDate !== targetDate || !String(row['内容'] || '').trim() || String(row['内容']).length > 200) continue;
    const recipientRef = 'friend:' + createHash('sha256').update(target.friendEmail).digest('hex');
    let receipt = prior[0];
    if (receipt && (receipt['收件人标识'] !== recipientRef || receipt['触发年份'] !== today.slice(0, 4) || receipt['触发日期'] !== today.slice(5))) continue;
    if (!receipt) {
      receipt = { 投递ID: identifier('DLV'), 投稿ID: id, 收件人标识: recipientRef, 收件人学号: '',
        触发日期: today.slice(5), 触发年份: today.slice(0, 4), 来源: '写给挚友', 邮件状态: '待发送', 站内状态: '仅邮件', 投递时间: '', 失败原因: '' };
      const saved = await client.appendRow('温暖祝福投递表', receipt);
      if (!saved?._id) throw Error('friend_delivery_receipt_unconfirmed');
      receipt._id = saved._id;
      deliveries.push(receipt);
    }
    const result = await send({ to: target.friendEmail,
      subject: '南京大学红十字会｜挚友为你写了一封生日祝福',
      text: `生日快乐！你的挚友托我们在今天送上这段祝福：\n\n${row['内容']}\n\n—— ${row['署名昵称'] || '你的挚友'}\n\n这是一封由朋友主动撰写、经平台审核后发送的一次性生日祝福，无需注册或回复。`,
      kind: 'warmth-friend-birthday', idempotencyKey: `WARMTH-FRIEND:${id}:${targetDate}` });
    const delivered = result?.ok && ['smtp', 'idempotent-skip'].includes(result.transport) && !result.devCodeChannel;
    await client.updateRow('温暖祝福投递表', receipt._id, { 邮件状态: delivered ? '已发送' : '发送失败',
      投递时间: delivered ? now.toISOString() : '', 失败原因: delivered ? '' : '邮件尚未确认发送，请核对邮件任务状态。' });
    if (delivered) { receipt['邮件状态'] = '已发送'; summary.delivered++; await onDelivered?.(row, receipt); }
    else summary.pending++;
  }
  return summary;
}
