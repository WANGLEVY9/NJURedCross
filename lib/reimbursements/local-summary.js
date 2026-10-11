import { randomUUID } from 'node:crypto';
import { SUMMARY_LIMITS, summaryFailure, checkedText, objectFields, normalizeActivity, normalizeSummaryForm, chineseAmount } from './summary-contract.js';
import { processSummaryPdf } from './summary-processor.js';

/** Private memory only. This module has no network client or remote write adapter. */
export function createLocalSummaries({ requests, bundles, queue, actorId, reviewer, now, reserveBytes, generate = processSummaryPdf }) {
  const activities = new Map(), summaries = new Map(), claims = new Map(), receipts = new Map();
  const claim = item => claims.get(`${item.id}:${item.revision}`) || null;
  function eligibility(item) {
    const summaryId = claim(item);
    const reason = item.status !== 'approved' ? '仅审核通过的申请可汇总' : !item.activityId || !item.expenseItems?.length
      ? '缺少活动关联或支出明细，等待用户端对接' : summaryId ? '已纳入汇总，请下载已有记录' : '';
    return { eligible: !reason, reason, summaryId };
  }
  function listActivities(actor) {
    actorId(actor);
    return { ok: true, protocolVersion: 1, activities: [...activities.values()].map(item => actor.canReview === true
      ? structuredClone(item) : { id: item.id, name: item.name, date: item.date, location: item.location }) };
  }
  function saveActivity(actor, body) {
    reviewer(actor);
    return queue(() => {
      const normalized = normalizeActivity(body);
      const id = body.id === undefined ? randomUUID() : checkedText(body.id, '活动 ID', 160), existing = activities.get(id);
      if (existing && body.revision !== existing.revision) throw summaryFailure('活动资料版本已变化，请刷新后保存。', 409);
      if (!existing && body.revision !== undefined) throw summaryFailure('活动资料不存在，请重新创建。', 409);
      if (!existing && activities.size >= 100) throw summaryFailure('本地活动数量已达上限。', 413);
      const activity = { ...normalized, id, revision: (existing?.revision || 0) + 1, updatedAt: now() };
      activities.set(id, activity); return { ok: true, activity: structuredClone(activity) };
    });
  }
  function validateActivity(id) { if (!activities.has(id)) throw summaryFailure('活动不存在，请先维护活动资料。'); }
  function build(actor, body) {
    reviewer(actor);
    objectFields(body, ['activityId', 'activityRevision', 'selections', 'mergeSameItems', 'form', 'idempotencyKey', 'duplicateMaterialsConfirmed'], '活动汇总');
    const activity = activities.get(body.activityId);
    if (!activity) throw summaryFailure('请选择有效活动。');
    if (body.activityRevision !== activity.revision) throw summaryFailure('活动资料版本已变化，请刷新后预览。', 409);
    if (['date', 'location', 'description', 'unitName', 'fundAccount'].some(key => !activity[key]) || !activity.participantCount)
      throw summaryFailure('请先补齐活动日期、地点、人数、目的与内容、单位名称和经费卡号。');
    if (body.mergeSameItems !== undefined && typeof body.mergeSameItems !== 'boolean') throw summaryFailure('合并选项须为布尔值。');
    if (body.duplicateMaterialsConfirmed !== undefined && typeof body.duplicateMaterialsConfirmed !== 'boolean') throw summaryFailure('重复材料核对选项须为布尔值。');
    const form = normalizeSummaryForm(body.form);
    if (!Array.isArray(body.selections) || !body.selections.length || body.selections.length > SUMMARY_LIMITS.requests)
      throw summaryFailure(`请选择 1 至 ${SUMMARY_LIMITS.requests} 笔申请。`);
    const ids = new Set(), rows = [], selections = [], materials = [], hashOwners = new Map(), unmergedAttachments = [];
    let pageCount = 0, materialBytes = 0, totalCents = 0;
    for (const selection of body.selections) {
      objectFields(selection, ['requestId', 'revision'], '所选申请');
      if (ids.has(selection.requestId)) throw summaryFailure('不能重复选择同一申请。'); ids.add(selection.requestId);
      const item = requests.get(selection.requestId);
      if (!item) throw summaryFailure('所选申请不存在。', 404);
      if (item.revision !== selection.revision) throw summaryFailure('申请版本已变化，请刷新后重新选择。', 409);
      if (item.activityId !== activity.id) throw summaryFailure('所选申请不属于同一个活动。');
      const state = eligibility(item); if (!state.eligible) throw summaryFailure(state.reason, state.summaryId ? 409 : 400);
      if (item.expenseItems.reduce((sum, row) => sum + row.amountCents, 0) !== item.amountCents) throw summaryFailure('申请明细与金额不一致，请重新核对。');
      const bundle = bundles.get(item.bundleId);
      if (!bundle) throw summaryFailure('申请材料不存在。', 404);
      totalCents += item.amountCents; pageCount += bundle.pageCount; materialBytes += bundle.merged.length;
      if (pageCount >= SUMMARY_LIMITS.pages || materialBytes > SUMMARY_LIMITS.bytes) throw summaryFailure('所选材料超出 300 页或 100 MB 限制，请分批汇总。', 413);
      selections.push({ requestId: item.id, revision: item.revision, code: item.code, applicant: item.name, amountCents: item.amountCents, bundleId: item.bundleId });
      materials.push({ requestId: item.id, bytes: bundle.merged, sources: bundle.sources.map((source, index) => ({ ...source, name: bundle.downloadNames?.[index] || source.name })) });
      bundle.sources.forEach((source, index) => {
        if (source.preview === 'original-only') unmergedAttachments.push({ requestId: item.id, name: bundle.downloadNames?.[index] || source.name,
          sha256: source.sha256, url: `/api/preview/reimbursements/bundles/${bundle.id}/original/${index}` });
      });
      for (const source of bundle.sources) {
        const owners = hashOwners.get(source.sha256) || new Set(); owners.add(item.code); hashOwners.set(source.sha256, owners);
      }
      for (const expense of item.expenseItems) rows.push({ label: expense.label, ...(expense.category ? { category: expense.category } : {}), amountCents: expense.amountCents, note: expense.note,
        origins: [{ requestId: item.id, code: item.code, revision: item.revision, itemId: expense.id, amountCents: expense.amountCents }] });
    }
    if (rows.length > SUMMARY_LIMITS.rows) throw summaryFailure('所选明细超过 200 项，请分批汇总。', 413);
    let resultRows = rows;
    if (body.mergeSameItems) {
      const grouped = new Map();
      for (const row of rows) {
        const key = JSON.stringify([row.category || '', row.label, row.note]);
        const existing = grouped.get(key);
        if (existing) { existing.amountCents += row.amountCents; existing.origins.push(...row.origins); }
        else grouped.set(key, structuredClone(row));
      }
      resultRows = [...grouped.values()];
    }
    const duplicateMaterials = [...hashOwners.entries()].filter(([, owners]) => owners.size > 1).map(([sha256, owners]) => ({ sha256, requestCodes: [...owners] }));
    return { summary: { protocolVersion: 1, activity: structuredClone(activity), form, selections, rows: resultRows,
      mergeSameItems: Boolean(body.mergeSameItems), totalCents, amountUpper: chineseAmount(totalCents), attachmentPages: pageCount, duplicateMaterials,
      ...(unmergedAttachments.length ? { unmergedAttachments } : {}) }, materials };
  }
  const root = '/api/preview/reimbursements/summaries';
  function publicSummary(item) {
    const { formPdf: _form, packetPdf: _packet, ...manifest } = item;
    return structuredClone({ ...manifest, formUrl: `${root}/${item.id}/form`, packetUrl: `${root}/${item.id}/packet` });
  }
  function preview(actor, body) { return { ok: true, summary: build(actor, body).summary }; }
  function create(actor, body) {
    reviewer(actor);
    return queue(async () => {
      const key = checkedText(body.idempotencyKey, '操作标识', 160);
      const receiptKey = `${actor.id}:${key}`, fingerprint = JSON.stringify(body), previous = receipts.get(receiptKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw summaryFailure('同一操作标识不能用于不同汇总内容。', 409);
        return { ok: true, duplicate: true, summary: publicSummary(summaries.get(previous.id)) };
      }
      if (summaries.size >= 30) throw summaryFailure('本地汇总数量已达上限。', 413);
      const { summary, materials } = build(actor, body);
      if (summary.duplicateMaterials.length && body.duplicateMaterialsConfirmed !== true) throw summaryFailure('申请中存在字节相同的材料，请核对后勾选重复材料确认。');
      const item = { ...summary, id: randomUUID(), code: `HZ-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: now(), actor: actor.id,
        duplicateMaterialsConfirmed: body.duplicateMaterialsConfirmed === true };
      const files = await generate(item, materials);
      reserveBytes(files.formPdf.length + files.packetPdf.length);
      Object.assign(item, files); summaries.set(item.id, item);
      for (const selection of item.selections) claims.set(`${selection.requestId}:${selection.revision}`, item.id);
      receipts.set(receiptKey, { fingerprint, id: item.id });
      return { ok: true, summary: publicSummary(item) };
    });
  }
  function get(actor, id) {
    reviewer(actor); const item = summaries.get(id); if (!item) throw summaryFailure('汇总记录不存在。', 404); return item;
  }
  function list(actor) { reviewer(actor); return { ok: true, summaries: [...summaries.values()].reverse().map(publicSummary) }; }
  function download(actor, id, kind) {
    const item = get(actor, id);
    if (!['form', 'packet'].includes(kind)) throw summaryFailure('汇总文件不存在。', 404);
    return { name: `${item.activity.name}-${kind === 'form' ? '活动费报销表' : '完整报销材料'}-${item.code}.pdf`, bytes: Buffer.from(kind === 'form' ? item.formPdf : item.packetPdf) };
  }
  return { eligibility, listActivities, saveActivity, validateActivity, preview, create, list, download,
    activityName: id => activities.get(id)?.name || '',
    get: (actor, id) => ({ ok: true, summary: publicSummary(get(actor, id)) }) };
}
