/**
 * 批量写：把「同表的 N 次单行写」收敛成「1 次批量写」。
 *
 * 单行写循环在跨境链路上会被逐次放大：N 次 300 ms 的往返就是 1.8 s，
 * 用户提交带附件的投稿时会直接突破 1 s。批量接口只付一次往返。
 *
 * 这里只做调用形态的收敛，不改变写入语义：
 *   · 失败照常向上抛，不吞异常、不重试；
 *   · 表名由调用方给出，写表记账由客户端代理统一完成；
 *   · 客户端缺少批量能力时（测试替身）退回逐条，行为与改造前一致。
 */

/** SeaTable 单次批量写上限是 1000，取 200 留出余量，避免单请求体过大。 */
const BATCH_SIZE = 200;

function hasBatch(client, method) {
  return client && typeof client[method] === 'function';
}

/**
 * @param {object} client SeaTable 客户端（可能被写表记账代理包裹）
 * @param {string} table 表名
 * @param {Array<{rowId:string, fields:object}>} updates 目标行与要写入的字段
 */
export async function updateRows(client, table, updates) {
  if (!Array.isArray(updates) || updates.length === 0) return;
  const normalised = updates.map(({ rowId, fields }) => ({
    row_id: rowId,
    ...fields,
  }));

  if (normalised.length === 1 || !hasBatch(client, 'batchUpdateRows')) {
    for (const { row_id: rowId, ...fields } of normalised) {
      await client.updateRow(table, rowId, fields);
    }
    return;
  }

  for (let start = 0; start < normalised.length; start += BATCH_SIZE) {
    await client.batchUpdateRows(table, normalised.slice(start, start + BATCH_SIZE));
  }
}

/**
 * @param {object} client SeaTable 客户端
 * @param {string} table 表名
 * @param {string[]} rowIds 要删除的行 ID
 */
export async function deleteRows(client, table, rowIds) {
  if (!Array.isArray(rowIds) || rowIds.length === 0) return;
  const ids = rowIds.filter((id) => typeof id === 'string' && id);

  if (ids.length === 1 || !hasBatch(client, 'batchDeleteRows')) {
    for (const id of ids) await client.deleteRow(table, id);
    return;
  }

  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    await client.batchDeleteRows(table, ids.slice(start, start + BATCH_SIZE));
  }
}
