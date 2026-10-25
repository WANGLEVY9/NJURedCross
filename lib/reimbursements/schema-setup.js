import { REIMBURSEMENT_SCHEMA, inspectReimbursementSchema } from './table-schema.js';
import { storageFailure } from './material-codec.js';

export function planReimbursementSchema(metadata) {
  if (!Array.isArray(metadata?.tables)) throw storageFailure('reimbursement_schema_invalid_metadata');
  for (const definition of REIMBURSEMENT_SCHEMA) {
    const matches = metadata.tables.filter(table => table.name === definition.name);
    if (matches.length > 1 || matches.some(table => !Array.isArray(table.columns)
      || new Set(table.columns.map(column => column.name)).size !== table.columns.length)) {
      throw storageFailure('reimbursement_schema_ambiguous');
    }
  }
  const inspection = inspectReimbursementSchema(metadata);
  if (inspection.mismatched.length) throw storageFailure('reimbursement_schema_type_conflict');
  return inspection.missing.map(item => item.column ? { action: 'add-column', table: item.table, name: item.column, type: item.type }
    : { action: 'add-table', table: item.table, columns: Object.entries(REIMBURSEMENT_SCHEMA.find(table => table.name === item.table).columns)
      .map(([name, type]) => ({ name, type })) });
}

/** Schema additions only. No row calls, deletes, renames, resets or activation. */
export async function ensureReimbursementSchema(client, { expectedUuid, apply = false, confirmation = '' } = {}) {
  if (!expectedUuid || client.dtableUuid !== expectedUuid) throw storageFailure('reimbursement_base_mismatch');
  if (apply && confirmation !== 'ADD-REIMBURSEMENT-SCHEMA') throw storageFailure('reimbursement_schema_confirmation_missing');
  const before = await client.getMetadata(), plan = planReimbursementSchema(before), performed = [];
  if (!apply) return { ready: !plan.length, apply: false, plan, rowWrites: 0 };
  for (const operation of plan) {
    const latest = await client.getMetadata(), current = planReimbursementSchema(latest);
    if (!current.some(item => item.action === operation.action && item.table === operation.table && item.name === operation.name)) continue;
    // One attempt only. An uncertain result is reconciled through metadata,
    // never blindly retried (which can create duplicate names).
    try {
      if (operation.action === 'add-table') await client.addTable(operation.table, 'zh-cn', operation.columns.map((column, index) => ({
        column_name: column.name, column_type: column.type, anchor_column: index ? operation.columns[index - 1].name : '',
      })));
      else await client.insertColumn(operation.table, operation.name, operation.type, '');
    } catch { /* Read back the same table/column before deciding whether it exists. */ }
    const remaining = planReimbursementSchema(await client.getMetadata());
    if (remaining.some(item => item.table === operation.table && (operation.action === 'add-table' || item.name === operation.name))) {
      throw storageFailure('reimbursement_schema_addition_unconfirmed');
    }
    performed.push(operation);
  }
  const after = await client.getMetadata();
  if (planReimbursementSchema(after).length) throw storageFailure('reimbursement_schema_incomplete');
  for (const table of before.tables) {
    const preserved = after.tables.find(item => item.name === table.name && (!table._id || item._id === table._id));
    if (!preserved || table.columns.some(column => {
      const found = preserved.columns.find(item => item.name === column.name);
      return !found || found.type !== column.type || column.key && found.key !== column.key
        || JSON.stringify(found.data) !== JSON.stringify(column.data);
    })) throw storageFailure('reimbursement_schema_existing_changed');
  }
  return { ready: true, apply: true, performed, rowWrites: 0, existingColumnsPreserved: true };
}
