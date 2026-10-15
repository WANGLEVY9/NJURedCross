/* ==========================================================================
   core/mock.js — frontend-only mock data for the materials centre.
   The public materials catalog, inbound registration and reimbursement flows
   have no backend yet. These functions stand in for that API so the UI can be
   built and reviewed first. When the real endpoints land, replace the bodies
   of the MOCK: entries in core/api.js — this file can then be removed.
   ========================================================================== */

/** In-memory catalog. `remaining` is deliberately varied (0 / low / normal). */
const CATALOG = [
  { id: 'MAT-001', name: '急救箱', unit: '个', remaining: 12, location: '仙林 · 柜 A-1' },
  { id: 'MAT-002', name: '电子血压计', unit: '台', remaining: 6, location: '仙林 · 柜 A-2' },
  { id: 'MAT-003', name: 'AED 除颤仪', unit: '台', remaining: 2, location: '仙林 · 柜 A-3' },
  { id: 'MAT-004', name: '折叠担架', unit: '副', remaining: 0, location: '仙林 · 柜 B-1' },
  { id: 'MAT-005', name: '折叠桌椅', unit: '套', remaining: 20, location: '仙林 · 库房' },
  { id: 'MAT-006', name: '宣传展架', unit: '套', remaining: 8, location: '仙林 · 库房' },
  { id: 'MAT-007', name: '便携扩音器', unit: '台', remaining: 3, location: '仙林 · 柜 A-4' },
  { id: 'MAT-008', name: '对讲机', unit: '部', remaining: 10, location: '仙林 · 柜 A-5' },
  { id: 'MAT-009', name: '折叠帐篷', unit: '顶', remaining: 1, location: '仙林 · 库房' },
  { id: 'MAT-010', name: '雨棚', unit: '顶', remaining: 0, location: '仙林 · 库房' },
  { id: 'MAT-011', name: '志愿者马甲', unit: '件', remaining: 40, location: '仙林 · 柜 C-1' },
  { id: 'MAT-012', name: '应急手电筒', unit: '支', remaining: 15, location: '仙林 · 柜 A-6' },
];

export function mockMaterialCatalog() {
  return CATALOG.map((item) => ({ ...item }));
}

/** Fallback activity names for the reimbursement picker when /api/public/events is empty. */
const FALLBACK_ACTIVITIES = [
  { id: 'EVT-FB-001', name: '仙林校区无偿献血日现场服务' },
  { id: 'EVT-FB-002', name: '急救知识进社区宣讲' },
  { id: 'EVT-FB-003', name: '新生入学报到志愿服务' },
];

export function mockActivityList() {
  return FALLBACK_ACTIVITIES.map((item) => ({ ...item }));
}

/* In-memory records, cleared on reload. */
const inboundRecords = [];
const reimbursementRecords = [];

let seq = 0;
function nextCode(prefix) {
  seq += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${String(seq).padStart(3, '0')}`;
}

export function mockInboundSubmit(payload) {
  const record = {
    id: nextCode('INB'),
    name: payload.name || '未命名物资',
    quantity: Number(payload.quantity) || 1,
    location: payload.location || '未标注',
    note: payload.note || '',
    status: '待审核',
    submittedAt: new Date().toISOString(),
  };
  inboundRecords.unshift(record);
  return { code: record.id, status: record.status };
}

export function mockReimbursementList() {
  return reimbursementRecords.map((item) => ({ ...item }));
}

export function mockReimbursementCreate(payload) {
  const record = {
    id: nextCode('REI'),
    eventId: payload.eventId || '',
    eventName: payload.eventName || '未关联活动',
    amount: Number(payload.amount) || 0,
    description: payload.description || '',
    status: '待审核',
    submittedAt: new Date().toISOString(),
  };
  reimbursementRecords.unshift(record);
  return { ...record };
}
