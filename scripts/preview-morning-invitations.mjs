/** Loopback-only invitation preview. Synthetic data, no SMTP or external requests. */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../lib/http/static.js';
import { morningInvitationRoutes, createInvitationToken, invitationTokenHash } from '../lib/morning/invitations.js';
import { MORNING_CARD_TABLE, MORNING_INVITE_TABLE } from '../lib/morning/shared.js';
import { toMorningPlazaDetailView } from '../lib/morning/plaza.js';

const port = Number(process.env.PORT || 3301);
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
const csrf = randomBytes(24).toString('hex');
const staticFile = createStaticHandler(fileURLToPath(new URL('../public/', import.meta.url)));
const accounts = {
  inviter: { email: 'friend@example.test', label: '木吉' },
  recipient: { email: 'preview@example.test', label: '预览用户' },
};
const card = { _id: 'card-row', 名片ID: 'PREVIEW-CARD', 账号ID: 'inviter', 昵称: '木吉',
  性别快照: '男', 院系快照: '电子科学与工程学院', 年级快照: '2025级', 展示院系: '是', 展示年级: '是',
  校区: '仙林', 兴趣标签: JSON.stringify(['音乐', '电影']),
  备注: '会弹一点吉他，也喜欢旧电影，想认识愿意分享歌单的人。', 审核状态: '已发布', 发布时间: new Date().toISOString() };
const invitations = [], messages = [], sentKeys = new Set();
const recipientCard = { ...card, _id: 'recipient-card-row', 名片ID: 'PREVIEW-RECIPIENT', 账号ID: 'recipient', 昵称: '预览用户' };
const session = { username: 'preview-recipient', accountId: 'recipient', role: 'platform_admin' };
function json(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); }
async function readJson(req) { let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) throw Error('body too large'); } return JSON.parse(body || '{}'); }
const client = {
  appendRow: async (_table, row) => { const saved = { ...row, _id: row['邀约ID'] }; invitations.push(saved); return { _id: saved._id }; },
  updateRow: async (_table, id, patch) => Object.assign(invitations.find(row => row._id === id), patch),
};
const ctx = { getBase: async () => client, listRows: async (_client, table) => table === MORNING_CARD_TABLE ? [card, recipientCard] : table === MORNING_INVITE_TABLE ? invitations : [],
  assertCompleteRows() {}, actor: () => 'recipient', requirePortalSession: () => session,
  requirePortalWrite: (req, res) => { if (req.headers['x-csrf-token'] === csrf) return session; json(res, 403, { ok: false, code: 'csrf_failed' }); return null; },
  enforcePublicLimit() {}, readJsonObject: readJson, json, inviteSecret: secret, publicBaseUrl: origin,
  accountForRef: async ref => accounts[ref], recordAudit() {},
  sendMail: async message => { if (!sentKeys.has(message.idempotencyKey)) { sentKeys.add(message.idempotencyKey); messages.push(message); } return { ok: true, transport: 'idempotent-skip' }; },
};
const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const html = body => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>早安晚安 · 本地预览</title><style>body{font:17px/1.8 system-ui;max-width:800px;margin:60px auto;padding:24px;background:#fff9f5;color:#38282c}a{color:#b51e3b}section{padding:24px;margin:24px 0;border:1px solid #ead7da;border-radius:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:12px;cursor:pointer}</style>${body}</html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/preview/incoming') {
      let created;
      await morningInvitationRoutes({ method: 'POST', headers: {}, body: {} }, {}, new URL('/api/morning/cards/PREVIEW-RECIPIENT/invitations', origin), {
        ...ctx, actor: () => 'inviter', requirePortalWrite: () => ({ accountId: 'inviter' }),
        readJsonObject: async () => ({ message: '你好，想和你分享最近听到的歌，也想一起看看老电影。' }),
        json: (_res, status, body) => { created = { status, body }; },
      });
      if (created?.status !== 201) return json(res, 500, { ok: false, message: '预览邮件生成失败' });
      const message = messages.find(message => message.idempotencyKey === `MORNING-INVITE:${created.body.invitation.id}`);
      const body = escape(message.text).replace(/https?:\/\/[^\s<]+/g, link => `<a href="${link}">${link}</a>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html(`<p><a href="/preview">返回预览入口</a> · 本机模拟收件箱，不发送真实邮件</p><section><p>发件人：南京大学红十字会（演示）<br>收件人：${escape(message.to)}</p><h1>${escape(message.subject)}</h1><hr><pre>${body}</pre></section>`));
    }
    if (url.pathname === '/preview' || url.pathname === '/preview/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html(`<h1>早安晚安 · 好友邀约预览</h1><p>此处仅使用本机合成名片，已自动模拟收件人登录；所有邮箱均为演示地址，不发送真实邮件。</p><section><h2>被邀约者收到的邮件</h2><p><a href="/preview/incoming">查看收件效果</a>（包含实际代码生成的标题、正文及可点击的邀约链接）</p></section><section><h2>体验完整窗口</h2><p><a href="/preview/new">打开一封新的邀约</a>（每次点击都可重新体验同意或拒绝）</p><p>同意后展示对方邮箱并记录成功结识；拒绝后关闭窗口并返回演示广场。</p></section><section><h2>查看发起人收到的结果邮件</h2><p><a href="/preview/mail">查看本地模拟发件箱</a></p></section>`));
    }
    if (url.pathname === '/preview/new') {
      const id = `PREVIEW-${randomBytes(6).toString('hex')}`;
      const expiresAt = new Date(Date.now() + 3 * 86400000).toISOString();
      const token = createInvitationToken({ invitationId: id, expiresAt, secret });
      invitations.push({ _id: id, 邀约ID: id, 名片ID: card.名片ID, 发起人账号ID: 'inviter', 发起人昵称: card.昵称, 发起人邮箱: accounts.inviter.email,
        收件人账号ID: 'recipient', 收件人昵称: '预览用户', 邀约附言: '你好，想和你分享最近听到的歌，也想一起看看老电影。', 状态: '已发送',
        过期时间: expiresAt, 创建时间: new Date().toISOString(), 反馈令牌哈希: invitationTokenHash(token) });
      res.writeHead(302, { Location: `/morning/invite-feedback?token=${encodeURIComponent(token)}`, 'Cache-Control': 'no-store' }); return res.end();
    }
    if (url.pathname === '/preview/mail') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html(`<h1>本地模拟发件箱</h1><p>仅记录在内存中，未发送真实邮件。</p><a href="/preview">返回预览入口</a>${messages.map(message => `<section><h2>${escape(message.subject)}</h2><p>收件人：${escape(message.to)}</p><pre>${escape(message.text)}</pre></section>`).join('') || '<p>尚未选择同意或拒绝。</p>'}`));
    }
    if (url.pathname === '/morning/plaza') { res.writeHead(302, { Location: '/preview' }); return res.end(); }
    if (url.pathname === '/api/auth/session') return json(res, 200, { ok: true, authenticated: true, csrfToken: csrf, user: { ...session, label: '本地预览用户', permissions: ['community'], consoleAccess: true, surfaces: ['portal', 'console'], email: accounts.recipient.email } });
    if (url.pathname === '/api/public/warmth/capabilities') return json(res, 200, { ok: true, morning: { enabled: true, ready: true }, birthday: { enabled: true, ready: true } });
    if (url.pathname === '/api/telemetry/client') { req.resume(); res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/api/morning/invitations/feedback/')) return await morningInvitationRoutes(req, res, url, ctx);
    if (url.pathname === '/api/morning/cards') return json(res, 200, { ok: true, cards: [toMorningPlazaDetailView(card)], viewer: { canBrowse: true, canInvite: false }, stats: { total: 1 } });
    if (url.pathname.startsWith('/api/')) return json(res, 200, { ok: true, notifications: [], stats: {}, profile: { missing: [] }, enrollments: [], registrations: [], submissions: [] });
    return await staticFile(req, res, url);
  } catch { if (!res.headersSent) json(res, 500, { ok: false, message: '本地预览暂不可用' }); else res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Morning invitation preview: ${origin}/preview (synthetic data, no SMTP)`));
