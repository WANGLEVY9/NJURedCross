import { createHash, randomUUID } from 'node:crypto';
import { MATERIAL_TABLES, integer } from './service.js';
import { createMutationQueue } from '../events/safety.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
function signedIn(actor) { if (!actor?.id) fail(401, '请先登录。'); }
function reviewer(actor) { signedIn(actor); if (actor.canReview !== true) fail(403, '需要物资管理权限。'); }
function text(value, label, max = 500, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value.replace(/[\r\n\t]/g, ''))) fail(400, `请填写${label}，不超过 ${max} 个字符。`);
  return value.trim();
}

/** Own-account returns in the isolated local fixture; never a remote writer. */
export function createLocalReturns({ service, fixture }) {
  const queue = createMutationQueue(), records = new Map(), photos = new Map(), receipts = new Map();
  let photoBytes = 0;
  async function ownedLoans(actor) {
    signedIn(actor);
    const owned = new Set((await fixture.listRows(MATERIAL_TABLES.applications)).filter(row => row['本地申请人'] === actor.id).map(row => row._id));
    const data = await service.overview();
    return data.applications.filter(item => owned.has(item.id)).map(item => {
      const material = data.inventory.find(row => row.code === item.assetCode);
      return { id: item.id, code: item.code, assetCode: item.assetCode, name: material?.name || item.items, unit: material?.unit || '件',
        status: item.status, verified: item.verified && !item.syncPending, outstanding: item.outstandingQuantity, plannedReturnDate: item.plannedReturnDate,
        pendingReturn: [...records.values()].some(record => record.applicationId === item.id && record.status === 'pending') };
    });
  }
  async function listLoans(actor) {
    return { ok: true, local: true, loans: (await ownedLoans(actor)).filter(item => item.verified && item.outstanding > 0 && item.status.includes('借出')) };
  }
  async function submit(actor, body, photo) {
    signedIn(actor);
    const applicationId = text(body.applicationId, '原借用单', 160), key = text(body.idempotencyKey, '操作标识', 160);
    const quantity = integer(body.quantity, '归还数量', { min: 1 }), note = text(body.note, '归还说明', 500, true);
    if (!(photo instanceof File) || !photo.size || !/^image\/(jpeg|png|webp)$/.test(photo.type)) fail(400, '请上传 JPG、PNG 或 WebP 归还照片。');
    if (photo.size > 8 * 1024 * 1024) fail(413, '归还照片不能超过 8 MB。');
    const bytes = Buffer.from(await photo.arrayBuffer());
    const fingerprint = JSON.stringify({ applicationId, quantity, note, type: photo.type, hash: createHash('sha256').update(bytes).digest('hex') });
    return queue(async () => {
      const receiptKey = `${actor.id}:${key}`, previous = receipts.get(receiptKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, '同一操作标识不能用于不同归还内容。');
        return { ok: true, local: true, duplicate: true, record: structuredClone(records.get(previous.id)) };
      }
      if (records.size >= 100 || photoBytes + bytes.length > 100 * 1024 * 1024) fail(413, '本轮本地归还记录已达容量上限。');
      const loan = (await ownedLoans(actor)).find(item => item.id === applicationId);
      if (!loan) fail(404, '借用单不存在或不属于当前账号。');
      if (!loan.verified || !loan.status.includes('借出') || !loan.outstanding) fail(409, '原借用单尚未出库、已结清或需要管理员核查。');
      if (loan.pendingReturn) fail(409, '该借用单已有待核对归还，请先等待管理员处理。');
      if (quantity > loan.outstanding) fail(409, `归还数量不能超过待还数量 ${loan.outstanding}。`);
      const id = randomUUID();
      const record = { id, code: `RT-${id.slice(0, 8).toUpperCase()}`, owner: actor.id, applicationId, applicationCode: loan.code,
        assetCode: loan.assetCode, name: loan.name, unit: loan.unit, quantity, note, status: 'pending', revision: 1,
        createdAt: new Date().toISOString(), photoUrl: `/api/public/materials/returns/${id}/photo` };
      records.set(id, record); photos.set(id, { bytes, type: photo.type }); photoBytes += bytes.length;
      receipts.set(receiptKey, { id, fingerprint });
      return { ok: true, local: true, record: structuredClone(record) };
    });
  }
  function list(actor, reviewing = false) {
    if (reviewing) reviewer(actor); else signedIn(actor);
    return { ok: true, local: true, records: [...records.values()].filter(item => reviewing || item.owner === actor.id).map(item => structuredClone(item)) };
  }
  function photo(actor, id) {
    signedIn(actor);
    const record = records.get(id);
    if (!record || (record.owner !== actor.id && actor.canReview !== true)) fail(404, '归还照片不存在。');
    const file = photos.get(id);
    return { ...file, bytes: Buffer.from(file.bytes) };
  }
  function review(actor, id, body) {
    reviewer(actor);
    return queue(async () => {
      const record = records.get(id);
      if (!record) fail(404, '归还登记不存在。');
      if (record.status !== 'pending' || body.revision !== record.revision) fail(409, '记录已核对或版本已变化，请刷新。');
      if (!['approve', 'reject'].includes(body.action)) fail(400, '请选择核对通过或退回。');
      const note = text(body.note, '核对说明', 500, body.action === 'approve');
      if (body.action === 'reject' && record.flowId) fail(409, '归还已记入流水，只能重试同步，不能退回。');
      let result;
      if (body.action === 'approve') {
        if (body.physicalChecked !== true) fail(400, '请先核对实物、数量与完好情况。');
        const image = photos.get(id);
        // Core validates original checkout, outstanding balance and stock under locks.
        // A fixed key recovers pending synchronization without crediting stock twice.
        result = await service.applicationAction(record.applicationId, 'return', {
          assetCode: record.assetCode, quantity: record.quantity, lossQuantity: 0,
          idempotencyKey: `portal-return:${id}`, note: `${record.code} · ${record.note}${note ? ` · 核对：${note}` : ''}`,
        }, new File([image.bytes], 'return-photo', { type: image.type }));
        record.flowId = result.flowId || result.flow?.id || record.flowId;
        record.syncPending = Boolean(result.syncPending);
        if (result.syncPending) return { ok: true, local: true, syncPending: true, record: structuredClone(record), message: result.message };
      }
      Object.assign(record, { status: body.action === 'approve' ? 'approved' : 'rejected', revision: record.revision + 1,
        reviewedAt: new Date().toISOString(), reviewer: actor.id, reviewNote: note });
      return { ok: true, local: true, record: structuredClone(record) };
    });
  }
  return { listLoans, submit, list, photo, review };
}
