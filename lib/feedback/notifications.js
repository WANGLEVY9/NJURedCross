/* ==========================================================================
   notifications.js — durable email for platform problem feedback.
   Reuses lib/mailer.js `sendMail` (which already enqueues retryable kinds into
   the durable delivery/retry stores) — never a second sender. Recipient
   resolution is an injected hook so the team can re-point it at the actual
   centre-head / presidium mapping without changing the send path. A failure to
   notify never blocks the underlying submit/reply write; the caller catches.
   ========================================================================== */

const FEEDBACK_PUBLIC_PATH = '/feedback';

function newIssueText(issue, origin) {
  const detailUrl = `${origin.replace(/\/$/, '')}${FEEDBACK_PUBLIC_PATH}`;
  return [
    `收到一条新的平台问题反馈（${issue.code}）。`,
    '',
    `分类：${issue.category}`,
    `业务域：${issue.domain}`,
    `提交来源：${issue.source}`,
    `联系方式：${issue.contact || '未填写'}`,
    '',
    '描述：',
    issue.description || '（未填写）',
    '',
    '请登录管理平台处理台查看并分派处理。',
  ].join('\n');
}

function replyText(issue, origin) {
  const detailUrl = `${origin.replace(/\/$/, '')}${FEEDBACK_PUBLIC_PATH}`;
  return [
    `你在平台提交的问题（${issue.code}）已收到回复。`,
    '',
    `分类：${issue.category}`,
    '',
    '处理说明：',
    issue.note || '（未填写）',
    '',
    '如仍有疑问，可继续在原问题下补充联系方式后重新提交。',
  ].join('\n');
}

function emails(recipients) {
  return (Array.isArray(recipients) ? recipients : [])
    .map((recipient) => (typeof recipient === 'string' ? recipient : recipient?.email))
    .filter((email) => typeof email === 'string' && email.includes('@'));
}

export function createFeedbackNotifications({ sendMail, resolveRecipients = async () => [], enabled = () => true, origin = 'https://njuredcross.cn' } = {}) {
  async function notifyNewIssue(issue) {
    if (!enabled()) return { sent: false, skipped: true, reason: 'notifications_disabled' };
    const recipients = emails(await resolveRecipients({ domain: issue.domain, category: issue.category, kind: 'new', issue }));
    if (!recipients.length) return { sent: false, skipped: true, reason: 'no_recipients' };
    const results = [];
    for (const to of recipients) {
      results.push(await sendMail({
        to,
        subject: `[问题反馈] ${issue.category}：${issue.code}`,
        text: newIssueText(issue, origin),
        kind: 'feedback.notice.new',
        idempotencyKey: `FEEDBACK-NEW:${issue.id}:${to}`,
      }));
    }
    return { sent: results.some((result) => result?.ok), results };
  }

  async function notifyReply(issue, to) {
    if (!enabled()) return { sent: false, skipped: true, reason: 'notifications_disabled' };
    const recipients = emails(to ? [to] : await resolveRecipients({ domain: issue.domain, category: issue.category, kind: 'reply', issue }));
    if (!recipients.length) return { sent: false, skipped: true, reason: 'no_recipients' };
    const results = [];
    for (const recipient of recipients) {
      results.push(await sendMail({
        to: recipient,
        subject: `[问题反馈] 你的问题已回复（${issue.code}）`,
        text: replyText(issue, origin),
        kind: 'feedback.reply',
        idempotencyKey: `FEEDBACK-REPLY:${issue.id}:${recipient}`,
      }));
    }
    return { sent: results.some((result) => result?.ok), results };
  }

  return { notifyNewIssue, notifyReply };
}
