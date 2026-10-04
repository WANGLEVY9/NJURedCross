/** Synthetic fixtures only. Nothing here opens a data service or reads credentials. */
export const FIXTURE_TABLES = Object.freeze({
  inventory: '工位物资表', applications: '物资管理', config: '物资配置表', flows: '物资流水表',
});

const column = (name, type = 'text', options = []) => ({
  name, key: name, type,
  ...(options.length ? { data: { options: options.map((value) => ({ name: value, id: value })) } } : {}),
});

function inventoryRow(id, name, quantity, unit, cabinet, level) {
  return { _id: id, 物资名称: name, 初始数量: quantity, 现有数量: quantity, 借出数量: 0, 归还数量: 0,
    单位: unit, 中心: '合成苏州中心', 柜号: cabinet, 层数: level, 物资管理: [] };
}

function applicationRow(id, name, purpose, items, quantity, status, approval, returnDate) {
  return { _id: id, 姓名: name, 借用用途: purpose, 借用物资名及数量: items, 借用件数: quantity,
    状态: status, 借出审批: approval, 拟借用日期: '2026-10-04', 拟归还日期: returnDate,
    归还件数: 0, 归还状态: '', 物资出库照片: [], 物资归还照片: [] };
}

function flowRow(id, assetId, material, operation, quantity, before, applicationId = '', loss = 0, day = '2026-10-03') {
  const delta = ['入库', '归还', '盘点增加'].includes(operation) ? quantity : -quantity;
  return { _id: id, 流水编号: `SYNTH-${id}`, 申请单ID: applicationId, 资产编码: `NJU-RC-${assetId}`,
    物资名称: material, 操作类型: operation, 数量: quantity, 操作前数量: before,
    操作后数量: before + delta, 损耗数量: loss, 操作时间: day,
    操作人: '本地合成管理员', 异常说明: loss ? '合成场景：损耗需核查' : '',
    流转去向: applicationId ? '合成借用活动' : '合成物资储存柜', 幂等键: `fixture:${id}` };
}

/** A fresh, private in-memory store for each preview or test. */
export function createMaterialsFixtures() {
  const inventory = [
    inventoryRow('synthetic-kit', '急救箱（合成）', 12, '个', '合成A柜', '1'),
    inventoryRow('synthetic-pressure', '血压计（合成）', 6, '台', '合成A柜', '2'),
    inventoryRow('synthetic-speaker', '扩音器（合成）', 5, '台', '合成B柜', '1'),
    inventoryRow('synthetic-camera', '拍摄器材（合成）', 3, '台', '合成B柜', '2'),
    inventoryRow('synthetic-stickers', '宣传贴纸（合成）', 100, '张', '合成C柜', '1'),
    inventoryRow('synthetic-tent', '帐篷（合成）', 2, '顶', '合成C柜', '2'),
  ];
  const applications = [
    applicationRow('synthetic-pending', '合成同学甲', '合成校园宣传', '扩音器（合成）2台', 2, '待审批', '待审核', '2026-10-10'),
    applicationRow('synthetic-approved', '合成同学乙', '合成班级急救演练', '急救箱（合成）2个', 2, '开始', '审批通过', '2026-10-10'),
    { ...applicationRow('synthetic-partial', '合成同学丙', '合成分批归还', '急救箱（合成）4个', 4, '借出（物资）', '审批通过', '2026-10-10'),
      实际借用日期: '2026-10-02', 归还件数: 2, 归还状态: '物品缺失/数量减少' },
    { ...applicationRow('synthetic-overdue', '合成同学丁', '合成逾期借用', '血压计（合成）5台', 5, '借出（物资）', '审批通过', '2026-10-01'),
      实际借用日期: '2026-09-29' },
    applicationRow('synthetic-sync', '合成同学戊', '合成待同步恢复演示', '拍摄器材（合成）1台', 1, '开始', '审批通过', '2026-10-10'),
  ];
  const flows = [
    flowRow('synthetic-out-kit', 'synthetic-kit', '急救箱（合成）', '出库', 4, 12, 'synthetic-partial', 0, '2026-10-02'),
    flowRow('synthetic-return-kit', 'synthetic-kit', '急救箱（合成）', '归还', 2, 8, 'synthetic-partial', 1),
    flowRow('synthetic-out-pressure', 'synthetic-pressure', '血压计（合成）', '出库', 5, 6, 'synthetic-overdue', 0, '2026-09-29'),
  ];
  // More than eight entries makes the full-ledger paging feature reviewable.
  for (let index = 0; index < 12; index++) {
    flows.push(flowRow(`synthetic-ledger-${index}`, 'synthetic-stickers', '宣传贴纸（合成）',
      index % 2 ? '盘点减少' : '盘点增加', 1, index % 2 ? 101 : 100, '', 0,
      `2026-09-${String(10 + index).padStart(2, '0')}`));
  }
  const configs = inventory.map((item) => ({ _id: `config-${item._id}`, 资产编码: `NJU-RC-${item._id}`,
    预警阈值: item._id === 'synthetic-pressure' ? 2 : 1, 阈值启用: true }));
  const rows = { [FIXTURE_TABLES.inventory]: inventory, [FIXTURE_TABLES.applications]: applications,
    [FIXTURE_TABLES.config]: configs, [FIXTURE_TABLES.flows]: flows };
  const metadata = { tables: [
    { name: FIXTURE_TABLES.inventory, columns: [column('物资名称'), column('中心', 'single-select', ['合成苏州中心', '合成南京中心']),
      column('单位'), column('柜号'), column('层数'), ...['初始数量', '现有数量', '借出数量', '归还数量'].map((name) => column(name, 'number'))] },
    { name: FIXTURE_TABLES.config, columns: [column('资产编码'), column('预警阈值', 'number'), column('阈值启用', 'checkbox')] },
    { name: FIXTURE_TABLES.applications, columns: [...['姓名', '借用用途', '借用物资名及数量', '状态', '借出审批', '归还状态'].map((name) => column(name)),
      column('借用件数', 'number'), column('归还件数', 'number'), column('物资出库照片', 'image'), column('物资归还照片', 'image')] },
    { name: FIXTURE_TABLES.flows, columns: [...['流水编号', '申请单ID', '资产编码', '物资名称', '操作类型', '操作人', '异常说明', '流转去向', '幂等键'].map((name) => column(name)),
      ...['数量', '操作前数量', '操作后数量', '损耗数量'].map((name) => column(name, 'number')), column('操作时间', 'date')] },
  ] };
  let sequence = 0;
  const failures = new Map();
  const tableRows = (table) => {
    if (!Object.hasOwn(rows, table)) throw new Error(`Synthetic table not found: ${table}`);
    return rows[table];
  };
  const listRows = async (table) => {
    const result = structuredClone(tableRows(table));
    Object.defineProperty(result, 'readMeta', { value: { total: result.length, truncated: false, maxRows: null } });
    return result;
  };
  const client = {
    async getMetadata() { return structuredClone(metadata); },
    async listRows(table, _view, _order, _convert, start = 0, limit = 500) { return structuredClone(tableRows(table).slice(start, start + limit)); },
    async appendRow(table, row) {
      const item = { ...structuredClone(row), _id: `synthetic-added-${++sequence}`, _mtime: '2026-10-04T12:00:00+08:00' };
      tableRows(table).push(item);
      return { _id: item._id };
    },
    async updateRow(table, id, patch) {
      const key = `${table}:${id}`;
      if ((failures.get(key) || 0) > 0) {
        failures.set(key, failures.get(key) - 1);
        throw new Error('仅合成场景：申请更新暂时失败');
      }
      const item = tableRows(table).find((row) => row._id === id);
      if (!item) throw new Error(`Synthetic row not found: ${id}`);
      Object.assign(item, structuredClone(patch));
      return { _id: id };
    },
  };
  return { client, listRows,
    failNextUpdate(table, id) { failures.set(`${table}:${id}`, (failures.get(`${table}:${id}`) || 0) + 1); },
    snapshot() { return structuredClone(rows); },
  };
}
