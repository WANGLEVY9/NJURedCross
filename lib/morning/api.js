import { randomBytes } from 'node:crypto';

export const MORNING_CARD_TABLE = '早安晚安名片表';
export const MORNING_CARD_STATUS = Object.freeze({
  PENDING: '待审核',
  PUBLISHED: '已发布',
  RETURNED: '需修改',
  REJECTED: '已拒绝',
  WITHDRAWN: '已下架',
  DELETED: '已删除',
});
export const MORNING_CAMPUS_OPTIONS = Object.freeze(['鼓楼', '仙林', '苏州', '浦口']);
export const MORNING_INTEREST_TAG_LIMIT = 5;
export const MORNING_NOTE_MAX_LENGTH = 200;

const NICKNAME_MAX_LENGTH = 40;
const TAG_MAX_LENGTH = 16;
const OTHER_CONTACT_MAX_LENGTH = 100;

function text(value) {
  return String(value ?? '').trim();
}

function cleanText(value, label, max, { allowNewlines = false } = {}) {
  const raw = text(value);
  if (!raw) throw Object.assign(new Error(`${label}不能为空。`), { field: label, statusCode: 400 });
  if (raw.length > max) throw Object.assign(new Error(`${label}不能超过 ${max} 字。`), { field: label, statusCode: 400 });
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(raw)) {
    throw Object.assign(new Error(`${label}包含不支持的控制字符。`), { field: label, statusCode: 400 });
  }
  if (!allowNewlines && /[\r\n]/.test(raw)) {
    throw Object.assign(new Error(`${label}不能包含换行。`), { field: label, statusCode: 400 });
  }
  return raw;
}

function optionalText(value, label, max, options) {
  const raw = text(value);
  return raw ? cleanText(raw, label, max, options) : '';
}

export function normalizeInterestTags(value) {
  const source = Array.isArray(value) ? value : text(value).split(/[,，、\n]+/);
  const tags = [];
  for (const item of source) {
    const tag = text(item);
    if (!tag) continue;
    if (tag.length > TAG_MAX_LENGTH) {
      throw Object.assign(new Error(`单个兴趣标签不能超过 ${TAG_MAX_LENGTH} 字。`), { field: 'interestTags', statusCode: 400 });
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MORNING_INTEREST_TAG_LIMIT) {
    throw Object.assign(new Error(`兴趣标签最多 ${MORNING_INTEREST_TAG_LIMIT} 个。`), { field: 'interestTags', statusCode: 400 });
  }
  return tags;
}

export function validateMorningCardInput(body = {}) {
  if (body.consent !== true) {
    throw Object.assign(new Error('必须确认自愿报名并接受人工审核。'), { field: 'consent', statusCode: 400 });
  }
  const nickname = cleanText(body.nickname, '昵称', NICKNAME_MAX_LENGTH);
  const campus = cleanText(body.campus, '校区', 10);
  if (!MORNING_CAMPUS_OPTIONS.includes(campus)) {
    throw Object.assign(new Error('请选择鼓楼、仙林、苏州或浦口校区。'), { field: 'campus', statusCode: 400 });
  }
  const interestTags = normalizeInterestTags(body.interestTags);
  const note = optionalText(body.note, '备注', MORNING_NOTE_MAX_LENGTH, { allowNewlines: true });
  const publishQQ = body.publishQQ === true;
  const publishWechat = body.publishWechat === true;
  const publishOther = body.publishOther === true;
  const otherContact = optionalText(body.otherContact, '其他联系方式', OTHER_CONTACT_MAX_LENGTH);
  if (publishOther && !otherContact) {
    throw Object.assign(new Error('选择公开其他联系方式后，需要填写具体内容。'), { field: 'otherContact', statusCode: 400 });
  }
  return { nickname, campus, interestTags, note, publishQQ, publishWechat, publishOther, otherContact };
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function boolFlag(value) {
  return value === true || value === '是' || value === 'true';
}

export function toMorningCardView(row) {
  return {
    id: String(row?.['名片ID'] || ''),
    accountId: String(row?.['账号ID'] || ''),
    realName: String(row?.['真实姓名快照'] || ''),
    studentId: String(row?.['学号快照'] || ''),
    gender: String(row?.['性别快照'] || ''),
    campus: String(row?.['校区'] || ''),
    nickname: String(row?.['昵称'] || ''),
    interestTags: parseTags(row?.['兴趣标签']),
    note: String(row?.['备注'] || ''),
    publishQQ: boolFlag(row?.['公开QQ']),
    publishWechat: boolFlag(row?.['公开微信']),
    publishOther: boolFlag(row?.['公开其他联系方式']),
    otherContact: String(row?.['其他联系方式'] || ''),
    status: String(row?.['审核状态'] || MORNING_CARD_STATUS.PENDING),
    reviewNote: String(row?.['审核意见'] || ''),
    reviewedAt: row?.['审核时间'] || null,
    submittedAt: row?.['提交时间'] || null,
    publishedAt: row?.['发布时间'] || null,
    updatedAt: row?.['更新时间'] || null,
  };
}

function cardRowFromInput({ id, accountId, account, input, now }) {
  return {
    名片ID: id,
    账号ID: accountId,
    真实姓名快照: String(account.realName || ''),
    学号快照: String(account.studentId || ''),
    性别快照: String(account.gender || ''),
    校区: input.campus,
    昵称: input.nickname,
    兴趣标签: JSON.stringify(input.interestTags),
    备注: input.note,
    公开QQ: input.publishQQ ? '是' : '否',
    公开微信: input.publishWechat ? '是' : '否',
    公开其他联系方式: input.publishOther ? '是' : '否',
    其他联系方式: input.publishOther ? input.otherContact : '',
    审核状态: MORNING_CARD_STATUS.PENDING,
    审核意见: '',
    审核人: '',
    审核时间: '',
    提交时间: now,
    发布时间: '',
    更新时间: now,
  };
}

function newCardId() {
  return `MNG-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function profileState(account) {
  const missing = [];
  if (!text(account?.realName)) missing.push('真实姓名');
  if (!text(account?.studentId)) missing.push('学号');
  if (!text(account?.gender)) missing.push('性别');
  return {
    identity: {
      realName: text(account?.realName),
      studentId: text(account?.studentId),
      gender: text(account?.gender),
      email: text(account?.email),
      campus: text(account?.campus),
      qq: text(account?.qq),
      wechat: text(account?.wechat),
    },
    missing,
  };
}

export async function morningRoutes(req, res, url, ctx) {
  if (!['/api/morning/card', '/api/morning/card/withdraw'].includes(url.pathname)) return false;

  const session = req.method === 'GET'
    ? ctx.requirePortalSession(req, res)
    : ctx.requirePortalWrite(req, res);
  if (!session) return true;

  const account = await ctx.accountForSession(session);
  if (!account) {
    ctx.json(res, 401, { ok: false, code: 'login_required', message: '请重新登录后再报名。' });
    return true;
  }
  const accountId = ctx.actor(session);
  const client = await ctx.getBase();

  if (req.method === 'GET') {
    const rows = await ctx.listRows(client, MORNING_CARD_TABLE);
    ctx.assertCompleteRows(rows);
    const card = rows.find((row) => String(row['账号ID'] || '') === accountId
      && String(row['审核状态'] || '') !== MORNING_CARD_STATUS.DELETED);
    const profile = profileState(account);
    return ctx.json(res, 200, {
      ok: true,
      profile: { ...profile.identity, missing: profile.missing },
      card: card ? toMorningCardView(card) : null,
    });
  }

  if (req.method === 'POST') {
    if (url.pathname === '/api/morning/card/withdraw') {
      const rows = await ctx.listRows(client, MORNING_CARD_TABLE);
      ctx.assertCompleteRows(rows);
      const existing = rows.find((row) => String(row['账号ID'] || '') === accountId
        && String(row['审核状态'] || '') !== MORNING_CARD_STATUS.DELETED);
      if (!existing) {
        return ctx.json(res, 404, { ok: false, message: '尚未报名早安晚安。' });
      }
      const now = new Date().toISOString();
      await client.updateRow(MORNING_CARD_TABLE, existing._id, {
        审核状态: MORNING_CARD_STATUS.WITHDRAWN,
        审核意见: '',
        审核人: '',
        审核时间: '',
        发布时间: '',
        更新时间: now,
      });
      await ctx.recordAudit(req, session, 'morning.card.withdraw', String(existing['名片ID'] || ''), 'success', {});
      return ctx.json(res, 200, {
        ok: true,
        card: toMorningCardView({ ...existing, 审核状态: MORNING_CARD_STATUS.WITHDRAWN, 更新时间: now }),
        message: '已退出早安晚安计划。',
      });
    }

    ctx.enforcePublicLimit(req, 'morning-card', 10, accountId);
    const profile = profileState(account);
    if (profile.missing.length) {
      return ctx.json(res, 409, {
        ok: false,
        code: 'profile_required',
        message: `请先在会员中心补全${profile.missing.join('、')}。`,
        missing: profile.missing,
      });
    }
    const input = validateMorningCardInput(await ctx.readJsonObject(req));
    const now = new Date().toISOString();
    const rows = await ctx.listRows(client, MORNING_CARD_TABLE);
    ctx.assertCompleteRows(rows);
    const existing = rows.find((row) => String(row['账号ID'] || '') === accountId
      && String(row['审核状态'] || '') !== MORNING_CARD_STATUS.DELETED);

    const id = existing ? String(existing['名片ID'] || newCardId()) : newCardId();
    const row = cardRowFromInput({ id, accountId, account, input, now });
    if (existing) {
      await client.updateRow(MORNING_CARD_TABLE, existing._id, row);
    } else {
      await client.appendRow(MORNING_CARD_TABLE, row);
    }
    await ctx.recordAudit(req, session, existing ? 'morning.card.resubmit' : 'morning.card.create', id, 'success', {
      campus: input.campus,
      interestTags: input.interestTags.length,
    });
    return ctx.json(res, existing ? 200 : 201, {
      ok: true,
      card: toMorningCardView({ ...row, _id: existing?._id }),
      message: existing ? '报名信息已更新，等待管理员审核。' : '报名已提交，等待管理员审核。',
    });
  }

  return ctx.json(res, 405, { ok: false, message: '请求方法不支持。' });
}
