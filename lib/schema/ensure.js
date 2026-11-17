/* ==========================================================================
   schema/ensure.js — idempotent SeaTable table-shape planning + application.
   New business modules declare their tables as `{ name: { column: type } }`
   maps and share this one battle-tested loop instead of re-deriving the
   add-table / add-column choreography (and its acknowledgement races) per
   module. Column types are `text`, `long-text` and `number` only: status and
   category columns are plain text so code can enforce frozen value sets
   without fighting SeaTable single-select option seeding.
   ========================================================================== */

export function planTableShapes(metadata, tables, failure) {
  const list = (metadata?.metadata || metadata)?.tables;
  if (!Array.isArray(list)) throw failure(503, '无法核验目标数据表结构。');
  const plan = [];
  for (const [name, columns] of Object.entries(tables)) {
    const matches = list.filter((table) => table.name === name);
    if (matches.length > 1) throw failure(503, `数据表「${name}」重名，须人工核对。`);
    if (!matches.length) {
      plan.push({ action: 'add-table', table: name, columns: Object.entries(columns).map(([columnName, type]) => ({ name: columnName, type })) });
      continue;
    }
    const existing = matches[0].columns || [];
    if (new Set(existing.map((column) => column.name)).size !== existing.length) throw failure(503, `数据表「${name}」列名冲突。`);
    for (const [columnName, type] of Object.entries(columns)) {
      const column = existing.find((item) => item.name === columnName);
      if (column && column.type !== type) throw failure(503, `数据表「${name}」字段「${columnName}」类型不匹配，不能自动修改。`);
      if (!column) plan.push({ action: 'add-column', table: name, name: columnName, type });
    }
  }
  return plan;
}

export async function ensureTableShapes(client, { expectedUuid, apply = false, confirmation = '', tables = {}, failure, confirmationPhrase = '' } = {}) {
  if (!expectedUuid || client.dtableUuid !== expectedUuid) throw failure(503, '业务 Base 与指定目标不一致。');
  if (apply && confirmation !== confirmationPhrase) throw failure(400, '缺少数据表结构新增确认。');
  const before = await client.getMetadata();
  const plan = planTableShapes(before, tables, failure);
  if (!apply) return { apply: false, ready: !plan.length, plan, rowWrites: 0 };
  for (const operation of plan) {
    const stillPending = async () => planTableShapes(await client.getMetadata(), tables, failure).some((item) => item.action === operation.action && item.name === operation.name);
    if (!(await stillPending())) continue;
    try {
      if (operation.action === 'add-table') await client.addTable(operation.table, 'zh-cn', operation.columns.map((column, index) => ({ column_name: column.name, column_type: column.type, anchor_column: index ? operation.columns[index - 1].name : '' })));
      else await client.insertColumn(operation.table, operation.name, operation.type, '');
    } catch { /* Lost acknowledgements are reconciled below; never blindly append twice. */ }
    if (await stillPending()) throw failure(503, '新增数据表结构尚未确认，请回读核对。');
  }
  const after = await client.getMetadata();
  return { apply: true, ready: !planTableShapes(after, tables, failure).length, rowWrites: 0, existingColumnsPreserved: true };
}
