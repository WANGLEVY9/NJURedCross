// Synthetic production contract. No credentials, real accounts or network clients.
import { createPublicMaterialsPortal } from '../../lib/materials/public-portal.js';
import { openPublicMaterialRequestStore } from '../../lib/materials/public-request-store.js';
import { MATERIAL_BORROW_DEPARTMENTS } from '../../lib/materials/membership-policy.js';
const { structuredClone } = globalThis;

export const materialActor = { id: 'synthetic-borrower', realName: '合成申请人', studentId: '123456789',
  email: 'synthetic@smail.nju.edu.cn', emailVerified: true };
export const materialBody = { materialId: 'synthetic-kit', assetCode: 'NJU-RC-synthetic-kit',
  quantity: 2, purpose: '合成志愿活动', plannedBorrowDate: '2099-10-21', plannedReturnDate: '2099-10-22',
  consent: true, idempotencyKey: 'synthetic-request-key-0001' };

export function publicMaterialsFixture({ file = ':memory:', today = () => '2026-10-21' } = {}) {
  const writes = [], queries = [], applications = [];
  const profiles = [{ _id: 'synthetic-profile', 姓名: materialActor.realName, 学号: materialActor.studentId,
    部门: MATERIAL_BORROW_DEPARTMENTS[0], 手机号: 'PRIVATE-PROFILE-FIELD' }];
  const summaries = [
    { id: 'synthetic-kit', code: 'NJU-RC-synthetic-kit', name: '合成急救箱', unit: '箱', quantity: 8, center: '合成工位', cabinet: 'A柜', level: '1层' },
    { id: 'synthetic-vest', code: 'NJU-RC-synthetic-vest', name: '马甲', unit: '件', quantity: 12 },
  ];
  const columns = ['姓名', '学号', '邮箱', '借用用途', '借用物资名及数量', '借用件数', '拟借用日期', '拟归还日期']
    .map(name => ({ name, type: 'text' }));
  columns.push({ name: '状态', type: 'single-select', data: { options: [{ name: '开始' }, { name: '待审批' }] } },
    { name: '借出审批', type: 'single-select', data: { options: [{ name: '审批通过' }] } },
    { name: '可借用物资', type: 'link', data: { link_id: 'synthetic-link', table_id: 'applications', other_table_id: 'inventory' } });
  const metadata = { tables: [{ name: '物资管理', _id: 'applications', columns }, { name: '工位物资表', _id: 'inventory' }] };
  const profileMetadata = { tables: [{ name: '个人主页（编辑版）', columns: [
    { name: '学号', type: 'text' }, { name: '部门', type: 'single-select' }, { name: '姓名', type: 'text' },
  ] }] };
  const profileBase = { getMetadata: async () => structuredClone(profileMetadata), query: async sql => {
    queries.push(sql);
    return structuredClone(profiles);
  } };
  const client = {
    getMetadata: async () => structuredClone(metadata),
    appendRow: async (table, row) => {
      writes.push({ method: 'appendRow', table, row: structuredClone(row) });
      const saved = { ...structuredClone(row), _id: `synthetic-application-${applications.length + 1}` };
      applications.push(saved);
      return { _id: saved._id };
    },
    updateLink: async (link, table, otherTable, id, ids) => {
      writes.push({ method: 'updateLink', link, table, otherTable, id, ids });
      applications.find(row => row._id === id)['可借用物资'] = ids.map(row_id => ({ row_id, display_value: '合成物资' }));
    },
    getRow: async (table, id) => structuredClone(applications.find(row => row._id === id)),
  };
  const store = openPublicMaterialRequestStore(file);
  const portal = createPublicMaterialsPortal({ getProfileBase: async () => profileBase,
    getInventory: async () => ({ summaries: structuredClone(summaries) }), store, today });
  return { portal, store, client, metadata, profileMetadata, profileBase, profiles, summaries, applications, writes, queries };
}
