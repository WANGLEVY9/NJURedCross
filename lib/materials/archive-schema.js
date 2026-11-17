/* ==========================================================================
   archive-schema.js — soft-archive column + backup table for material flows.
   Archiving never deletes rows: it flags 物资流水表 rows as 已归档 (hidden from
   the ledger, still counted by the stock ledger) after writing a full row
   snapshot into the backup table first. Schema is added idempotently.
   ========================================================================== */

export const MATERIAL_FLOW_ARCHIVE_COLUMN = '归档状态';
export const MATERIAL_FLOW_ARCHIVE_TABLE = '物资流水归档备份表';
export const MATERIAL_FLOWS_TABLE = '物资流水表';
export const MATERIAL_FLOW_ARCHIVE_STATUS = Object.freeze({ ACTIVE: '未归档', ARCHIVED: '已归档' });

export const MATERIAL_FLOW_ARCHIVE_COLUMNS = Object.freeze({
  '备份ID': 'text',
  '原流水ID': 'text',
  '归档时间': 'text',
  '操作人': 'text',
  '流水快照': 'long-text',
});

export function materialArchiveFailure(statusCode, message, code = 'materials_archive_invalid') {
  return Object.assign(new Error(message), { statusCode, code });
}

/** Returns the list of idempotent schema operations needed to reach the target shape. */
export function planMaterialArchiveSchema(metadata) {
  const tables = (metadata?.metadata || metadata)?.tables;
  if (!Array.isArray(tables)) throw materialArchiveFailure(503, '无法核验物资表结构。');
  const flows = tables.find((table) => table.name === MATERIAL_FLOWS_TABLE);
  if (!flows) throw materialArchiveFailure(503, `缺少「${MATERIAL_FLOWS_TABLE}」，无法增加归档字段。`);
  const plan = [];
  const flowColumns = flows.columns || [];
  const archiveColumn = flowColumns.find((column) => column.name === MATERIAL_FLOW_ARCHIVE_COLUMN);
  if (archiveColumn && archiveColumn.type !== 'text') throw materialArchiveFailure(503, '物资流水表「归档状态」字段类型不匹配，不能自动修改。');
  if (!archiveColumn) plan.push({ action: 'add-column', table: MATERIAL_FLOWS_TABLE, name: MATERIAL_FLOW_ARCHIVE_COLUMN, type: 'text' });

  const backup = tables.find((table) => table.name === MATERIAL_FLOW_ARCHIVE_TABLE);
  if (!backup) {
    plan.push({ action: 'add-table', table: MATERIAL_FLOW_ARCHIVE_TABLE, columns: Object.entries(MATERIAL_FLOW_ARCHIVE_COLUMNS).map(([name, type]) => ({ name, type })) });
  } else {
    const existing = backup.columns || [];
    for (const [name, type] of Object.entries(MATERIAL_FLOW_ARCHIVE_COLUMNS)) {
      const column = existing.find((item) => item.name === name);
      if (column && column.type !== type) throw materialArchiveFailure(503, '物资流水归档备份表字段类型不匹配，不能自动修改。');
      if (!column) plan.push({ action: 'add-column', table: MATERIAL_FLOW_ARCHIVE_TABLE, name, type });
    }
  }
  return plan;
}

export async function ensureMaterialArchiveSchema(client, { expectedUuid, apply = false, confirmation = '' } = {}) {
  if (!expectedUuid || client.dtableUuid !== expectedUuid) throw materialArchiveFailure(503, '物资业务 Base 与指定目标不一致。');
  if (apply && confirmation !== 'ADD-MATERIALS-ARCHIVE') throw materialArchiveFailure(400, '缺少物资流水归档结构新增确认。');
  const before = await client.getMetadata();
  const plan = planMaterialArchiveSchema(before);
  if (!apply) return { apply: false, ready: !plan.length, plan, rowWrites: 0 };
  for (const operation of plan) {
    const stillPending = async () => planMaterialArchiveSchema(await client.getMetadata()).some((item) => item.action === operation.action && item.name === operation.name);
    if (!(await stillPending())) continue;
    try {
      if (operation.action === 'add-table') await client.addTable(operation.table, 'zh-cn', operation.columns.map((column, index) => ({ column_name: column.name, column_type: column.type, anchor_column: index ? operation.columns[index - 1].name : '' })));
      else await client.insertColumn(operation.table, operation.name, operation.type, '');
    } catch { /* Lost acknowledgements are reconciled below; never blindly append twice. */ }
    if (await stillPending()) throw materialArchiveFailure(503, '新增物资归档结构尚未确认，请回读核对。');
  }
  const after = await client.getMetadata();
  return { apply: true, ready: !planMaterialArchiveSchema(after).length, rowWrites: 0, existingColumnsPreserved: true };
}
