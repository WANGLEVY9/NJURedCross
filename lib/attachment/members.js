/**
 * 成员目录检索（宣传审核的「美编登记」用）。
 *
 * 背景（2026-11-24）：文字稿件审核链第 1 级本来就叫「对接人初审（含美编招募）」，
 * 但系统从未记录招募结果——「宣传投稿表·美编人」既无录入入口也无数据，
 * 导致终审无法带出美编姓名/学号，更无法写进「新媒体审核表」。
 * 这里提供**按姓名或学号精确命中**的名册检索，让初审当场登记美编。
 *
 * 安全边界：
 *   · 名册（全体成员表）含身份证号、银行卡号、手机号等敏感列，
 *     因此 SQL 只 SELECT `_id/姓名/学号/院系/邮箱`，绝不 `SELECT *`；
 *   · 只做**精确等值**匹配，不做前缀/模糊匹配——否则任何持 outreach 权限的账号
 *     都能拿它枚举全会在册成员的通讯录；
 *   · 入参先过白名单式校验（长度、引号、反斜杠、控制字符），拒绝拼接注入；
 *   · 结果按学号去重（名册里存在同一人两行的历史重复），并限条数。
 */

/** 红会名册表名（与 lib/morning/coordinators.js 同一张底表）。 */
export const MEMBER_TABLE = '全体成员表（26~27学年）';

/** 检索词长度上限：姓名 ≤ 4 字、学号 ≤ 12 位，留足余量。 */
const QUERY_MAX_LENGTH = 32;

/** 单次返回上限：重名最多 3 组，20 条足够区分，避免一次吐出大段通讯录。 */
const RESULT_LIMIT = 20;

const unavailable = () => Object.assign(
  new Error('成员名册暂时无法读取，请稍后重试或联系管理员。'),
  { statusCode: 503, code: 'member_directory_unavailable' },
);

/**
 * 规范化检索词。返回空串表示无效（由调用方决定报 400 还是当作空查询）。
 * 只吞空白，不放宽成模糊匹配。
 */
export function normalizeMemberQuery(raw) {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > QUERY_MAX_LENGTH) return '';
  // 单引号会破坏 SQL 字面量；反斜杠与控制字符没有合法用途。
  if (/['"\\`\u0000-\u001f\u007f]/.test(value)) return '';
  return value;
}

/** 拼检索 SQL（值已通过 normalizeMemberQuery，不含可注入字符）。 */
export function memberLookupSql(query, { limit = RESULT_LIMIT } = {}) {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= RESULT_LIMIT ? limit : RESULT_LIMIT;
  const literal = `'${query}'`;
  return [
    'SELECT `_id`, `姓名`, `学号`, `院系`, `邮箱`',
    `FROM \`${MEMBER_TABLE}\``,
    `WHERE \`姓名\` = ${literal} OR \`学号\` = ${literal}`,
    `LIMIT ${safeLimit}`,
  ].join(' ');
}

/** 名册行 → 前端候选对象。邮箱由 formula 列给出，异常值直接丢弃。 */
export function memberCandidateOf(row) {
  const name = String(row?.['姓名'] ?? '').trim();
  const studentId = String(row?.['学号'] ?? '').trim();
  if (!name || !studentId) return null;
  const email = String(row?.['邮箱'] ?? '').trim().toLowerCase();
  return {
    id: String(row?.['_id'] ?? ''),
    name,
    studentId,
    faculty: String(row?.['院系'] ?? '').trim(),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
  };
}

/**
 * 按姓名或学号精确检索在册成员。
 * @returns {Promise<{query:string, members:Array, truncated:boolean}>}
 */
export async function findDirectoryMembers(client, raw, { limit = RESULT_LIMIT } = {}) {
  const query = normalizeMemberQuery(raw);
  if (!query) return { query: '', members: [], truncated: false };
  if (!client || typeof client.query !== 'function') throw unavailable();

  let rows;
  try {
    rows = await client.query(memberLookupSql(query, { limit }));
  } catch {
    throw unavailable();
  }
  if (!Array.isArray(rows) || rows.readMeta?.truncated) throw unavailable();

  const byStudentId = new Map();
  for (const row of rows) {
    const member = memberCandidateOf(row);
    if (!member) continue;
    // 名册存在同一人两行的历史重复（如「邓清怡」），按学号收敛为一条。
    if (!byStudentId.has(member.studentId)) byStudentId.set(member.studentId, member);
  }
  return {
    query,
    members: [...byStudentId.values()],
    truncated: rows.length >= limit,
  };
}
