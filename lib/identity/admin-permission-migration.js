import { CONSOLE_PERMISSION_SCOPES } from '../permissions.js';
import { ACCOUNT_TABLE, updateAccountFields } from './store.js';

export class PermissionMigrationError extends Error {}

const accountId = row => typeof row?.['账号ID'] === 'string' ? row['账号ID'].trim() : '';
const storedScope = row => {
  const value = row?.['权限范围'];
  if (value != null && typeof value !== 'string') throw new PermissionMigrationError('权限范围不是文本，停止迁移。');
  return value ?? '';
};

function rowsByAccountId(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = accountId(row);
    if (!id) continue;
    byId.set(id, byId.has(id) ? null : row);
  }
  return byId;
}

export function prepareAdminPermissionPlan(rows, baseUuid) {
  const byId = rowsByAccountId(rows);
  const entries = [];
  for (const row of rows) {
    if (row['角色'] !== 'platform_admin' || storedScope(row).trim()) continue;
    const id = accountId(row);
    if (!id || byId.get(id) !== row || typeof row._id !== 'string' || !row._id) {
      throw new PermissionMigrationError('空权限管理员缺少唯一账号 ID，停止生成计划。');
    }
    entries.push({ accountId: id, rowId: row._id, previous: storedScope(row), scopes: null });
  }
  return { version: 1, baseUuid, entries };
}

function nextScope(entry) {
  const { scopes } = entry;
  if (!Array.isArray(scopes) || new Set(scopes).size !== scopes.length
    || scopes.some(scope => !CONSOLE_PERMISSION_SCOPES.includes(scope))) {
    throw new PermissionMigrationError('每个账号都要确认 scopes，只能填写合法的模块权限。确认无模块权限时填 []。');
  }
  return CONSOLE_PERMISSION_SCOPES.filter(scope => scopes.includes(scope)).join(',') || 'none';
}

function checkRow(row, entry) {
  if (!row || row._id !== entry.rowId || accountId(row) !== entry.accountId || row['角色'] !== 'platform_admin') {
    throw new PermissionMigrationError('账号身份、行 ID 或管理员角色已变化，停止迁移。');
  }
  return storedScope(row);
}

export async function migrateAdminPermissions(base, rows, plan, {
  mode = 'preview', resume = false, freezePlan,
} = {}) {
  if (!['preview', 'apply', 'rollback'].includes(mode) || (mode === 'apply' && !resume && typeof freezePlan !== 'function')
    || (mode === 'rollback' && !resume)) {
    throw new PermissionMigrationError('写入前必须保存计划快照，回滚必须读取该快照。');
  }
  if (plan?.version !== 1 || !plan.baseUuid || plan.baseUuid !== base.dtableUuid || !Array.isArray(plan.entries)) {
    throw new PermissionMigrationError('迁移计划版本、身份 Base 或计划格式不匹配。');
  }
  const byId = rowsByAccountId(rows);
  const seen = new Set();
  const entries = plan.entries.map(entry => {
    if (typeof entry?.accountId !== 'string' || !entry.accountId || seen.has(entry.accountId)
      || typeof entry.rowId !== 'string' || !entry.rowId || typeof entry.previous !== 'string' || entry.previous.trim()) {
      throw new PermissionMigrationError('计划含重复账号或试图修改原本已配置的权限。');
    }
    seen.add(entry.accountId);
    const target = nextScope(entry);
    const current = checkRow(byId.get(entry.accountId), entry);
    if (current !== entry.previous && (!(resume || mode === 'rollback') || current !== target)) {
      throw new PermissionMigrationError('计划之外的权限已变化，请先人工核对。');
    }
    return { entry, from: mode === 'rollback' ? target : entry.previous, to: mode === 'rollback' ? entry.previous : target, current };
  });

  const pending = entries.filter(item => item.current !== item.to).length;
  if (mode === 'preview') return { total: entries.length, pending, changed: 0 };
  if (mode === 'apply' && !resume) await freezePlan();

  let changed = 0;
  for (const { entry, from, to } of entries) {
    const current = checkRow(await base.getRow(ACCOUNT_TABLE, entry.rowId), entry);
    if (current === to && (resume || mode === 'rollback')) continue;
    if (current !== from) throw new PermissionMigrationError('账号权限在执行期间变化，停止迁移。');
    try {
      await updateAccountFields(base, entry.rowId, { 权限范围: to });
    } catch {
      // The remote write might have succeeded before its response was lost.
      // Read the stored value before deciding whether the operator can resume.
    }
    if (checkRow(await base.getRow(ACCOUNT_TABLE, entry.rowId), entry) !== to) {
      throw new PermissionMigrationError('权限写入未通过回读核验。请保留计划和快照，核对后再继续。');
    }
    changed += 1;
  }
  return { total: entries.length, pending, changed };
}
