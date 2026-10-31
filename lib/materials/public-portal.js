import { createHash } from 'node:crypto';
import { readProfileCandidates } from '../identity/profile-query.js';
import { materialBorrowEligibility } from './membership-policy.js';
import { MEMBERSHIP_SOURCE_TABLE } from './membership-source.js';
import { borrowApprovalMode } from './borrow-policy.js';
import { assertRequestActive } from '../http/request-budget.js';

const APPLICATIONS = '物资管理', INVENTORY = '工位物资表', LINK = '可借用物资';
function fail(statusCode, code, message) { throw Object.assign(new Error(message), { statusCode, code, publicMaterialError: true }); }
const unavailable = () => fail(503, 'material_source_unavailable', '物资数据暂时无法核验，请稍后重试。');
const metadataTables = value => (value?.metadata || value)?.tables;
const text = value => typeof value === 'string' ? value.trim() : '';

export function materialLinkedIds(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const ids = value.map(v => typeof v === 'string' ? v : v?.row_id);
  return ids.every(id => typeof id === 'string' && id) ? ids : null;
}

// Never infer the inventory identity from a display name. Missing or ambiguous
// historical links need verification before they can affect inventory.
export function assertMaterialRequestAsset(application, item, quantity) {
  const ids = materialLinkedIds(application[LINK]);
  if (!ids || ids.length !== 1 || ids[0] !== item.id) {
    fail(409, 'material_application_asset_mismatch', '出库物资与申请关联的物资不一致，请核对原申请。');
  }
  if (quantity !== undefined && (!Number.isSafeInteger(Number(application['借用件数']))
    || Number(application['借用件数']) < 1 || quantity !== Number(application['借用件数']))) {
    fail(409, 'material_application_quantity_mismatch', '出库数量须与原申请件数一致，请核对原申请。');
  }
}

export function createPublicMaterialsPortal({ getProfileBase, getInventory, store, canBorrow = () => false, today = () => {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
} }) {
  async function eligibility(actor) {
    if (!actor?.id || actor.emailVerified !== true || !text(actor.realName)
      || !/^\d{6,20}$/.test(actor.studentId || '') || !text(actor.email)) {
      return materialBorrowEligibility({ status: 'unverified' });
    }
    if (canBorrow(actor) === true) return { eligible: true, status: 'eligible', department: '',
      source: 'authorized-account', message: '已具备物资借用资格。' };
    try {
      const base = await getProfileBase();
      const table = metadataTables(await base.getMetadata())?.find(t => t.name === MEMBERSHIP_SOURCE_TABLE);
      if (!table?.columns?.some(c => c.name === '学号' && c.type === 'text')
        || !table.columns.some(c => c.name === '部门' && c.type === 'single-select')) return materialBorrowEligibility({ status: 'unavailable' });
      const rows = await readProfileCandidates(base, actor.studentId);
      const matches = rows.filter(row => typeof row['学号'] === 'string' && row['学号'].trim() === actor.studentId);
      return materialBorrowEligibility(matches.length === 1 && text(matches[0]['姓名']) === text(actor.realName)
        ? { status: 'verified', department: matches[0]['部门'] } : { status: 'unverified' });
    } catch { return materialBorrowEligibility({ status: 'unavailable' }); }
  }

  async function catalog(client) {
    assertRequestActive();
    const bundle = await getInventory(client);
    assertRequestActive();
    if (!Array.isArray(bundle.summaries) || bundle.summaries.some(item => !item.id || !item.code
      || !Number.isSafeInteger(item.quantity) || item.quantity < 0)) return unavailable();
    return bundle.summaries.map(item => ({
      id: item.id, assetCode: item.code, name: item.name, unit: item.unit,
      remaining: item.quantity, location: [item.center, item.cabinet, item.level].filter(Boolean).join(' · '),
      approvalMode: borrowApprovalMode(item),
    }));
  }

  async function request(client, actor, body) {
    const qualification = await eligibility(actor);
    if (!qualification.eligible) fail(qualification.status === 'unavailable' ? 503 : 403,
      'material_borrow_ineligible', qualification.message);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'material_request_invalid', '申请格式不正确。');
    if (body.consent !== true) fail(400, 'material_consent_required', '请确认物资借用与归还责任条款。');
    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)) {
      fail(400, 'material_request_key_invalid', '申请标识无效，请刷新页面后重试。');
    }
    if (!text(body.materialId) || !text(body.assetCode)) fail(400, 'material_required', '请从库存目录选择物资。');
    const quantity = typeof body.quantity === 'number' ? body.quantity
      : typeof body.quantity === 'string' && /^[1-9]\d*$/.test(body.quantity) ? Number(body.quantity) : NaN;
    if (!Number.isSafeInteger(quantity) || quantity < 1) fail(400, 'material_quantity_invalid', '借用数量须为正整数。');
    const purpose = text(body.purpose);
    if (!purpose || purpose.length > 1000) fail(400, 'material_purpose_invalid', '请填写借用用途（不超过1000字）。');
    for (const date of [body.plannedBorrowDate, body.plannedReturnDate]) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        fail(400, 'material_date_invalid', '借用与归还日期格式不正确。');
      }
    }
    if (body.plannedReturnDate < body.plannedBorrowDate) fail(400, 'material_date_invalid', '归还日期不能早于借用日期。');
    const payload = { actor: actor.id, materialId: body.materialId, assetCode: body.assetCode,
      quantity, purpose, plannedBorrowDate: body.plannedBorrowDate, plannedReturnDate: body.plannedReturnDate };
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    // Scope the key to the signed-in account; a different account cannot replay
    // a receipt or discover another borrower's personal information.
    const key = createHash('sha256').update(`${actor.id}:${body.idempotencyKey}`).digest('hex');
    let receipt = store.get(key);
    if (receipt && receipt.fingerprint !== fingerprint) fail(409, 'material_request_conflict', '同一申请标识对应的内容已改变，请恢复原内容或重新发起申请。');
    if (receipt?.state === 'completed') return { ...receipt.result, replayed: true };
    if (receipt?.state === 'attempted') fail(409, 'material_request_uncertain', '申请保存结果待核查，请联系管理员核对，勿重复提交新申请。');
    if (!receipt && body.plannedBorrowDate < today()) fail(400, 'material_date_invalid', '拟借用日期不能早于今天。');

    assertRequestActive();
    const tables = metadataTables(await client.getMetadata());
    assertRequestActive();
    const app = tables?.find(t => t.name === APPLICATIONS), inventory = tables?.find(t => t.name === INVENTORY);
    const link = app?.columns?.find(c => c.name === LINK && c.type === 'link');
    if (!app || !inventory || !link?.data?.link_id || link.data.table_id !== app._id
      || link.data.other_table_id !== inventory._id || ['updateLink', 'appendRow', 'getRow'].some(method => typeof client[method] !== 'function')) return unavailable();
    for (const name of ['姓名', '学号', '邮箱', '借用用途', '借用物资名及数量', '借用件数', '拟借用日期', '拟归还日期', '状态', '借出审批']) {
      if (!app.columns.some(c => c.name === name)) return unavailable();
    }

    if (!receipt) {
      const item = (await catalog(client)).find(item => item.id === body.materialId && item.assetCode === body.assetCode);
      if (!item) fail(400, 'material_not_found', '所选物资不存在，请刷新库存目录。');
      if (item.remaining < quantity) fail(409, 'material_stock_insufficient', '所选物资剩余库存不足，请重新选择数量。');
      const automatic = item.approvalMode === 'automatic';
      const row = { 姓名: actor.realName, 学号: actor.studentId, 邮箱: actor.email,
        借用用途: purpose, 借用物资名及数量: `${item.name} × ${quantity} ${item.unit}`,
        借用件数: quantity, 拟借用日期: body.plannedBorrowDate, 拟归还日期: body.plannedReturnDate,
        状态: automatic ? '开始' : '待审批', ...(automatic ? { 借出审批: '审批通过' } : {}) };
      for (const name of ['状态', ...(automatic ? ['借出审批'] : [])]) {
        if (!app.columns.find(c => c.name === name)?.data?.options?.some(o => o.name === row[name])) return unavailable();
      }
      receipt = { key, fingerprint, state: 'attempted', row, materialId: item.id, automatic };
      assertRequestActive();
      if (!store.create(receipt)) fail(409, 'material_request_busy', '申请正在处理，请稍后使用原申请重试。');
      // From here on, an exception means the remote append might have happened.
      // Keep its durable receipt and never append a second row on a retry.
      let saved;
      try { saved = await client.appendRow(APPLICATIONS, row); }
      catch { fail(503, 'material_request_uncertain', '申请保存结果待核查，请联系管理员核对，勿重复提交新申请。'); }
      if (typeof saved?._id !== 'string' || !saved._id) fail(503, 'material_request_uncertain', '申请保存结果待核查，请联系管理员核对，勿重复提交新申请。');
      const next = { ...receipt, state: 'link_pending', rowId: saved._id };
      store.save(next, receipt); receipt = next;
    }
    // Replacing the exact link set is idempotent. A known row may resume this
    // stage after a timeout/restart without creating another application.
    try {
      assertRequestActive();
      const original = await client.getRow(APPLICATIONS, receipt.rowId);
      if (original?._id !== receipt.rowId || ['姓名', '学号', '邮箱', '借用物资名及数量'].some(name => original[name] !== receipt.row[name])
        || Number(original['借用件数']) !== receipt.row['借用件数']) throw new Error('Application changed');
      const previous = materialLinkedIds(original[LINK]);
      if (!previous || (previous.length && (previous.length !== 1 || previous[0] !== receipt.materialId))) throw new Error('Conflicting link');
      if (!previous.length) {
        assertRequestActive();
        await client.updateLink(link.data.link_id, APPLICATIONS, INVENTORY, receipt.rowId, [receipt.materialId]);
      }
      const linked = await client.getRow(APPLICATIONS, receipt.rowId);
      const ids = materialLinkedIds(linked?.[LINK]);
      if (linked?._id !== receipt.rowId || !ids || ids.length !== 1 || ids[0] !== receipt.materialId) throw new Error('Unconfirmed link');
    } catch { fail(503, 'material_link_pending', `申请 REQ-${receipt.rowId} 已保存，物资关联尚待确认；请保留原内容重试，勿新建重复申请。`); }
    const result = { request: { code: `REQ-${receipt.rowId}`, status: receipt.automatic ? '待出库' : '待审批',
      approvalMode: receipt.automatic ? 'automatic' : 'manual', items: receipt.row['借用物资名及数量'],
      plannedBorrowDate: receipt.row['拟借用日期'], plannedReturnDate: receipt.row['拟归还日期'] },
      message: receipt.automatic ? '马甲借用已自动通过，等待管理员备货出库。' : '借用申请已提交，等待物资管理员审批。' };
    store.save({ ...receipt, state: 'completed', result }, receipt);
    return result;
  }
  return { catalog, eligibility, request };
}
