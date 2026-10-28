/**
 * 会员中心志愿时长：只读对接「南大红会 志愿服务平台」Base 的「个人主页（编辑版）」。
 *
 * 匹配规则：姓名＋学号双字段精确匹配。平台账号的学号优先取账号表「学号」列，
 * 缺失时回退为校园邮箱前缀（自助注册强制前缀＝学号），因此注册后即可完成映射。
 * 读取失败、记录不完整或匹配不唯一时一律返回空，不编造数值。
 */

import { readPagedRows } from '../http/paged-rows.js';
import { rowsByValues } from '../http/rows-by-values.js';

export const VOLUNTEER_PLATFORM_TABLE = '个人主页（编辑版）';

/** 校园邮箱前缀即学号；缺学号列的历史账号由此完成映射。 */
export function studentIdFromAccount(account) {
  const stored = String(account?.studentId || '').trim();
  if (stored) return stored;
  const email = String(account?.email || account?.username || '').trim().toLowerCase();
  const local = email.split('@')[0] || '';
  return /^[0-9A-Za-z]{4,32}$/.test(local) ? local : '';
}

function matchKey(name, studentId) {
  const trimmedName = String(name || '').trim();
  const trimmedId = String(studentId || '').trim();
  return trimmedName && trimmedId ? `${trimmedName}|${trimmedId}` : null;
}

function parseHours(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

/** (姓名, 学号) → 时长；重复键数值一致可合并，冲突时标记为不可信。 */
export function buildVolunteerHoursIndex(rows) {
  const index = new Map();
  for (const row of rows || []) {
    const key = matchKey(row?.['姓名'], row?.['学号']);
    if (!key) continue;
    const entry = {
      totalHours: parseHours(row?.['总志愿时长']),
      academicYearHours: parseHours(row?.['志愿时长（25-26）']),
    };
    const existing = index.get(key);
    if (!existing) {
      index.set(key, entry);
      continue;
    }
    const conflicts = existing.totalHours !== entry.totalHours
      || existing.academicYearHours !== entry.academicYearHours;
    index.set(key, conflicts ? { ambiguous: true } : existing);
  }
  return index;
}

/** 匹配不到、记录冲突或数据不完整时返回 null，由界面显示破折号。 */
export function lookupVolunteerHours(index, account) {
  const key = matchKey(account?.realName, studentIdFromAccount(account));
  if (!index || !key) return null;
  const entry = index.get(key);
  if (!entry || entry.ambiguous) return null;
  return { totalHours: entry.totalHours, academicYearHours: entry.academicYearHours };
}

/** 读取必须完整：截断的外部数据不能当作可展示依据。 */
export async function readVolunteerPlatformHours(client) {
  const rows = await readPagedRows(client, VOLUNTEER_PLATFORM_TABLE, {
    pageSize: 1_000,
    maxRows: 100_000,
    requireComplete: true,
  });
  return buildVolunteerHoursIndex(rows);
}

const HOURS_COLUMNS = '姓名,学号,总志愿时长,志愿时长（25-26）';

/**
 * 单会员时长：按学号条件读取，只取展示所需列。
 *
 * 整表索引要翻 3,000+ 行（每页 1,000 行仍需 4 次往返，跨校区约 2–3 秒），而
 * 会员中心每次打开都要读一次。条件查询一次往返即可，冲突/缺失的判定与整表
 * 索引完全一致。适配器没有 SQL 能力时退回整表读取（结果相同，只是更慢）。
 */
export async function readVolunteerHoursFor(client, account) {
  const studentId = studentIdFromAccount(account);
  if (!studentId) return null;
  const rows = await rowsByValues(client, VOLUNTEER_PLATFORM_TABLE, '学号', [studentId], HOURS_COLUMNS);
  return lookupVolunteerHours(buildVolunteerHoursIndex(rows), account);
}
