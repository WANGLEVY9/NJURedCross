/**
 * 「宣传对接人表」邮箱回填（v3 seed 的收尾步骤）。
 *
 * 背景：`LIAISON_SEED` 只登记「谁负责哪个栏目」，不写邮箱；`apply-v3-schema.mjs`
 * 建表后把 `邮箱` 写成空串。而运行期 `pickAssignee()` 是**直接读这一列**的，
 * 没有任何「回退平台账号表」的逻辑（`store.js` 里那句注释曾长期误导）。于是新建
 * 环境 seed 完，汇总邮件会因为没有收件人而静默不发。
 *
 * 这里把「按姓名从平台账号表取邮箱」抽成纯函数，供脚本调用、也便于单测：
 *   · 只补空邮箱，绝不覆盖人工填过的值；
 *   · 同一姓名多条账号时优先「邮箱已验证=已验证」（生产身份库的实际取值，也兼容
 *     「是」）；仍不唯一就判为歧义，宁可留空并报到控制台，也不猜——发错人比不发更糟；
 *   · 状态明确为停用/禁用的账号不参与回填；
 *   · 邮箱取值顺序：`邮箱` → `收信邮箱`（身份库里两者都可能是唯一非空的）。
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 「邮箱已验证」在生产身份库里是「已验证 / 未验证」，不是「是 / 否」——两种都认。 */
const VERIFIED_VALUES = new Set(['是', '已验证', 'true', '1']);
/** 明确停用的账号不参与回填：给离职/停用的人发审核提醒比不发更糟。 */
const INACTIVE_VALUES = new Set(['停用', '已停用', '禁用', '已禁用', '冻结', '已冻结']);

const text = (value) => String(value ?? '').trim();

function accountEmail(row) {
  const primary = text(row?.['邮箱']);
  if (primary) return primary;
  return text(row?.['收信邮箱']);
}

/**
 * @param {Array} liaisonRows 「宣传对接人表」行（中文列名，含 `_id`）
 * @param {Array} accountRows 「平台账号表」行（中文列名）
 * @returns {{updates:Array<{rowId:string,name:string,email:string,source:string}>,
 *            ambiguous:Array<{rowId:string,name:string,emails:string[]}>,
 *            missing:Array<{rowId:string,name:string,reason:string}>,
 *            alreadyFilled:number}}
 */
export function planLiaisonEmailBackfill(liaisonRows = [], accountRows = []) {
  const byName = new Map();
  for (const account of Array.isArray(accountRows) ? accountRows : []) {
    const name = text(account?.['真实姓名'] ?? account?.['姓名']);
    const email = accountEmail(account);
    if (!name || !EMAIL_PATTERN.test(email)) continue;
    if (INACTIVE_VALUES.has(text(account?.['状态']))) continue;
    const list = byName.get(name) || [];
    list.push({ email, verified: VERIFIED_VALUES.has(text(account?.['邮箱已验证'])) });
    byName.set(name, list);
  }

  const updates = [];
  const ambiguous = [];
  const missing = [];
  let alreadyFilled = 0;

  for (const row of Array.isArray(liaisonRows) ? liaisonRows : []) {
    const rowId = text(row?._id);
    if (!rowId) continue;
    if (text(row?.['邮箱'] ?? row?.email)) { alreadyFilled += 1; continue; }
    const name = text(row?.['姓名'] ?? row?.name);
    if (!name) { missing.push({ rowId, name: '', reason: 'missing_name' }); continue; }
    const candidates = byName.get(name) || [];
    if (!candidates.length) { missing.push({ rowId, name, reason: 'no_account' }); continue; }
    const verified = candidates.filter((item) => item.verified);
    const pool = verified.length === 1 ? verified : candidates;
    const unique = [...new Set(pool.map((item) => item.email))];
    if (unique.length > 1) { ambiguous.push({ rowId, name, emails: unique }); continue; }
    updates.push({ rowId, name, email: unique[0], source: verified.length === 1 ? 'verified' : 'account' });
  }

  return { updates, ambiguous, missing, alreadyFilled };
}
