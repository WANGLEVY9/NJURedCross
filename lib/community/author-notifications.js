import { createHash } from 'node:crypto';

function key(event, values) {
  return `COMMUNITY:${event}:${createHash('sha256').update(JSON.stringify(values)).digest('hex')}`;
}
function memberUrl(origin, path) {
  try {
    const base = new URL(origin);
    if (!['https:', 'http:'].includes(base.protocol)) return '';
    return new URL(path, base).href;
  } catch { return ''; }
}

/** Only resolve the author from a stored account reference; no recipient identity in notices. */
async function dispatch({ author, accountForRef, send, message }) {
  if (!author || typeof accountForRef !== 'function' || typeof send !== 'function') return { ok: false, skipped: true };
  try {
    const account = await accountForRef(author);
    const email = String(account?.email || '').trim();
    if (!email || /[\r\n,;]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, skipped: true };
    return await send({ ...message, to: email, kind: 'community-notification' }, { renderTemplate: false });
  } catch { return { ok: false, code: 'community_notice_unavailable' }; }
}

export function notifyCommunityReview({ row, status, reviewedAt, revision = false, accountForRef, send, origin }) {
  const birthday = row['项目'] === 'birthday';
  if (!birthday && !row['名片ID']) return Promise.resolve({ ok: false, skipped: true });
  const id = String(birthday ? row['投稿ID'] : row['修订ID'] || row['名片ID']);
  const title = birthday ? '生日祝福投稿' : revision ? '早安晚安名片资料修订' : '早安晚安名片';
  const label = status === '已发布' || status === '已通过' ? '审核通过' : status;
  const note = String(row['审核意见'] || '');
  const link = memberUrl(origin, birthday ? '/me?focus=member-warmth-blessings' : '/morning');
  return dispatch({ author: birthday ? row['提交人'] : row['账号ID'], accountForRef, send,
    message: {
      subject: `南京大学红十字会｜${title}${label}`,
      text: `你的${title}审核状态已更新。\n\n编号：${id}\n当前状态：${label}${note ? `\n审核意见：${note}` : ''}\n\n${status === '需修改' ? '请登录平台查看意见、修改后重新提交。' : '可登录平台查看详情。'}${link ? `\n${link}` : ''}\n\n南京大学红十字会`,
      idempotencyKey: key('REVIEW', [birthday ? 'birthday' : revision ? 'revision' : 'card', id, String(row['版本号'] || row['提交时间'] || ''), status, reviewedAt]),
    },
  });
}

export function notifyBlessingDelivered({ blessing, receipt, accountForRef, send, origin }) {
  if (!['一对一匹配', '仓库抽取', '写给挚友'].includes(receipt['来源'])
    || (receipt['来源'] === '写给挚友' ? receipt['邮件状态'] !== '已发送' : receipt['站内状态'] !== '已投递')) return Promise.resolve({ ok: false, skipped: true });
  const id = String(receipt['投稿ID'] || '');
  const author = blessing.submitter || blessing['提交人'];
  const date = `${receipt['触发年份']}-${receipt['触发日期']}`;
  const link = memberUrl(origin, '/me?focus=member-warmth-blessings');
  return dispatch({ author, accountForRef, send, message: {
    subject: '南京大学红十字会｜你写的生日祝福已送出',
    text: `你写下的一份生日祝福已由平台送达，谢谢你留下这份温暖。\n\n投稿编号：${id}\n投递日期：${date}\n投递方式：${receipt['来源'] === '写给挚友' ? '写给挚友' : receipt['来源'] === '仓库抽取' ? '祝福仓库' : '随机匹配'}\n\n可登录平台查看你的祝福记录。${link ? `\n${link}` : ''}\n\n南京大学红十字会`,
    idempotencyKey: key('DELIVERED', [id, receipt['投递ID'] || receipt['收件人标识'], date]),
  } });
}
