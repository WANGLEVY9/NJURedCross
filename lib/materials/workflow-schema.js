import { MATERIAL_WORKFLOW_TABLE, MATERIAL_WORKFLOW_COLUMNS, materialFailure } from './workflow-store.js';

export function planMaterialWorkflowSchema(metadata) {
  const tables = (metadata?.metadata || metadata)?.tables;
  if (!Array.isArray(tables)) throw materialFailure(503, '无法核验物资表结构。');
  const matches = tables.filter(t => t.name === MATERIAL_WORKFLOW_TABLE);
  if (matches.length > 1) throw materialFailure(503, '物资登记表重名，须人工核对。');
  if (!matches.length) return [{ action: 'add-table', table: MATERIAL_WORKFLOW_TABLE, columns: Object.entries(MATERIAL_WORKFLOW_COLUMNS).map(([name, type]) => ({ name, type })) }];
  const columns = matches[0].columns || [];
  if (new Set(columns.map(c => c.name)).size !== columns.length) throw materialFailure(503, '物资登记表列名冲突。');
  return Object.entries(MATERIAL_WORKFLOW_COLUMNS).flatMap(([name, type]) => {
    const column = columns.find(c => c.name === name);
    if (column && column.type !== type) throw materialFailure(503, '物资登记表字段类型不匹配，不能自动修改。');
    return column ? [] : [{ action: 'add-column', table: MATERIAL_WORKFLOW_TABLE, name, type }];
  });
}
export async function ensureMaterialWorkflowSchema(client, { expectedUuid, apply = false, confirmation = '' } = {}) {
  if (!expectedUuid || client.dtableUuid !== expectedUuid) throw materialFailure(503, '物资业务 Base 与指定目标不一致。');
  if (apply && confirmation !== 'ADD-MATERIALS-WORKFLOW') throw materialFailure(400, '缺少物资登记表新增确认。');
  const before = await client.getMetadata(), plan = planMaterialWorkflowSchema(before);
  if (!apply) return { apply: false, ready: !plan.length, plan, rowWrites: 0 };
  for (const operation of plan) {
    if (!planMaterialWorkflowSchema(await client.getMetadata()).some(item => item.action === operation.action && item.name === operation.name)) continue;
    try {
      if (operation.action === 'add-table') await client.addTable(operation.table, 'zh-cn', operation.columns.map((c, i) => ({ column_name: c.name, column_type: c.type, anchor_column: i ? operation.columns[i - 1].name : '' })));
      else await client.insertColumn(operation.table, operation.name, operation.type, '');
    } catch { /* A lost acknowledgement is reconciled; never blindly append twice. */ }
    if (planMaterialWorkflowSchema(await client.getMetadata()).some(item => operation.action === 'add-table' || item.name === operation.name)) throw materialFailure(503, '新增物资结构尚未确认，请回读核对。');
  }
  const after = await client.getMetadata();
  for (const table of before.tables) {
    const preserved = after.tables.find(t => t.name === table.name && (!table._id || table._id === t._id));
    if (!preserved || table.columns.some(c => !preserved.columns.some(p => c.name === p.name && c.type === p.type && (!c.key || c.key === p.key) && JSON.stringify(c.data) === JSON.stringify(p.data)))) throw materialFailure(503, '既有业务表结构发生变化，请停止并核查。');
  }
  return { apply: true, ready: !planMaterialWorkflowSchema(after).length, rowWrites: 0, existingColumnsPreserved: true };
}
