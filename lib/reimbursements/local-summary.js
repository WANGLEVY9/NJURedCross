import { randomUUID } from 'node:crypto';
import { SUMMARY_LIMITS, summaryFailure, checkedText, objectFields, normalizeActivity, normalizeSummaryForm, chineseAmount } from './summary-contract.js';
import { processSummaryPdf } from './summary-processor.js';
import { hasFinalApproval } from './workflow.js';
import { LOCAL_LIMITS } from './state.js';
import { arrangeSummary } from './summary-order.js';
import { itemActivityId, itemFinalReview, financeRecord, syncFinanceRequest, financeKey } from './finance-items.js';
import { reimbursementActivityCategory } from '../../public/app/shared/reimbursement-activities.js';

/** Private memory only. This module has no network client or remote write adapter. */
export function createLocalSummaries({ requests, bundles, queue, actorId, reviewer, reader = reviewer, now, reserveBytes,
  allowLegacy = false, hasFinanceAccess = actor => actor.canReview === true, materialsFor, generate = processSummaryPdf,
  activities = new Map(), summaries = new Map(), claims = new Map(), receipts = new Map(),
  apiRoot = '/api/preview/reimbursements', limits = LOCAL_LIMITS, activityReview = false, requireDistinctReviewers = false }) {
  const claim = item => claims.get(`${item.id}:${item.revision}`) || null;
  function eligibility(item) {
    const summaryId = claim(item);
    if (activityReview && item.workflowVersion !== 3) return { eligible: false, reason: '旧流程记录请核查，不自动纳入活动终审', summaryId };
    if (activityReview && item.workflowVersion === 3) {
      const validInitial = item.initialReview?.revision === item.revision && item.initialReview?.bundleId === item.bundleId;
      const reason = item.status !== 'final_pending' || !validInitial ? '仅本版初审通过、待活动终审的申请可纳入'
        : !item.activityId || !item.expenseItems?.length ? '缺少活动关联或支出明细'
          : item.expenseItems.every(row => itemFinalReview(item, row)) ? '已完成活动终审' : '';
      return { eligible: !reason, reason, summaryId };
    }
    const verifiedFinal = hasFinalApproval(item);
    const reason = item.status !== 'approved' ? '仅复审通过的申请可汇总' : !verifiedFinal && !allowLegacy ? '旧流程或缺少有效复审结论，须核查' : !item.activityId || !item.expenseItems?.length
      ? '缺少活动关联或支出明细，等待用户端对接' : summaryId ? '已纳入汇总，请下载已有记录' : '';
    return { eligible: !reason, reason, summaryId };
  }
  function listActivities(actor) {
    actorId(actor);
    return { ok: true, protocolVersion: 1, activities: [...activities.values()].map(item => hasFinanceAccess(actor)
      ? structuredClone({ ...item, category: reimbursementActivityCategory(item) }) : { id: item.id, name: item.name, date: item.date, location: item.location,
        campus: item.campus || '', category: reimbursementActivityCategory(item) }) };
  }
  function saveActivity(actor, body) {
    reviewer(actor);
    return queue(() => {
      const normalized = normalizeActivity(body);
      const id = body.id === undefined ? randomUUID() : checkedText(body.id, '活动 ID', 160), existing = activities.get(id);
      if (existing && body.revision !== existing.revision) throw summaryFailure('活动资料版本已变化，请刷新后保存。', 409);
      if (!existing && body.revision !== undefined) throw summaryFailure('活动资料不存在，请重新创建。', 409);
      if (!existing && activities.size >= limits.activities) throw summaryFailure('活动数量已达容量上限。', 413);
      const activity = { ...normalized, category: body.category === undefined ? existing?.category || '' : normalized.category,
        id, revision: (existing?.revision || 0) + 1, updatedAt: now() };
      activities.set(id, activity); return { ok: true, activity: structuredClone(activity) };
    });
  }
  function validateActivity(id) { if (!activities.has(id)) throw summaryFailure('活动不存在，请先维护活动资料。'); }
  function build(actor, body) {
    reviewer(actor);
    objectFields(body, ['activityId', 'activityRevision', 'selections', 'mergeSameItems', 'itemOrder', 'settlements', 'form', 'idempotencyKey', 'duplicateMaterialsConfirmed'], '活动汇总');
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
    const ids = new Set(), rows = [], selections = [], materials = [], materialGroups = [], hashOwners = new Map(), unmergedAttachments = [];
    const settlements = new Map();
    if (body.settlements !== undefined) {
      if (!activityReview || !Array.isArray(body.settlements) || body.settlements.length > SUMMARY_LIMITS.rows) throw summaryFailure('核定金额格式不正确。');
      for (const value of body.settlements) {
        objectFields(value, ['requestId', 'itemId', 'amount', 'reason'], '核定金额');
        const key = financeKey(value.requestId, value.itemId);
        if (settlements.has(key) || typeof value.amount !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value.amount)) throw summaryFailure('核定金额存在重复或格式不正确。');
        const [yuan, fraction = ''] = value.amount.split('.');
        settlements.set(key, { amountCents: Number(yuan) * 100 + Number(fraction.padEnd(2, '0')), reason: checkedText(value.reason, '核定原因', 300, true) });
      }
    }
    let pageCount = 0, materialBytes = 0, totalCents = 0;
    for (const selection of body.selections) {
      objectFields(selection, ['requestId', 'revision', 'stateVersion', 'itemIds'], '所选申请');
      if (ids.has(selection.requestId)) throw summaryFailure('不能重复选择同一申请。'); ids.add(selection.requestId);
      const item = requests.get(selection.requestId);
      if (!item) throw summaryFailure('所选申请不存在。', 404);
      if (item.revision !== selection.revision) throw summaryFailure('申请版本已变化，请刷新后重新选择。', 409);
      if (activityReview && (item.workflowVersion !== 3 || selection.stateVersion !== item.stateVersion)) throw summaryFailure('申请审核状态已变化，请刷新后重新选择。', 409);
      const selectedIds = selection.itemIds === undefined ? item.expenseItems.map(row => row.id) : selection.itemIds;
      if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length
        || selectedIds.some(id => !item.expenseItems.some(row => row.id === id))) throw summaryFailure('所选支出条目不存在或重复。');
      const expenses = item.expenseItems.filter(row => selectedIds.includes(row.id));
      if (activityReview ? expenses.some(row => itemActivityId(item, row) !== activity.id || itemFinalReview(item, row)) : item.activityId !== activity.id)
        throw summaryFailure('所选条目不属于同一个活动，或已完成终审。');
      const state = eligibility(item); if (!state.eligible) throw summaryFailure(state.reason, state.summaryId ? 409 : 400);
      if (item.expenseItems.reduce((sum, row) => sum + row.amountCents, 0) !== item.amountCents) throw summaryFailure('申请明细与金额不一致，请重新核对。');
      const bundle = bundles.get(item.bundleId);
      if (!bundle) throw summaryFailure('申请材料不存在。', 404);
      if (!allowLegacy && typeof materialsFor !== 'function') throw summaryFailure('缺少本版按项目合并材料读取能力，不能使用原合并件替代。', 409);
      const prepared = allowLegacy ? [{ requestId: item.id, bytes: bundle.merged, pageCount: bundle.pageCount,
        sources: bundle.sources.map((source, index) => ({ ...source, name: bundle.downloadNames?.[index] || source.name })) }]
        : materialsFor(actor, item).filter(material => !material.expenseItemId || selectedIds.includes(material.expenseItemId));
      let selectedTotal = 0;
      for (const expense of expenses) {
        const settlement = settlements.get(financeKey(item.id, expense.id));
        const cents = settlement?.amountCents ?? expense.amountCents;
        if (cents > expense.amountCents) throw summaryFailure('核定金额不能超过原申请条目金额。');
        if (cents !== expense.amountCents && !settlement?.reason) throw summaryFailure('核定金额与原申请金额不一致时，请填写差额原因。');
        selectedTotal += cents;
        rows.push({ label: expense.label, ...(expense.category ? { category: expense.category } : {}), amountCents: cents,
          note: [expense.note, settlement?.reason].filter(Boolean).join('；'),
          origins: [{ requestId: item.id, code: item.code, revision: item.revision, itemId: expense.id, amountCents: cents,
            ...(settlement ? { originalCents: expense.amountCents, reason: settlement.reason } : {}) }] });
      }
      totalCents += selectedTotal;
      pageCount += prepared.reduce((sum, material) => sum + material.pageCount, 0);
      materialBytes += prepared.reduce((sum, material) => sum + material.bytes.length, 0);
      if (pageCount >= SUMMARY_LIMITS.pages || materialBytes > SUMMARY_LIMITS.bytes) throw summaryFailure('所选材料超出 300 页或 100 MB 限制，请分批汇总。', 413);
      selections.push({ requestId: item.id, revision: item.revision, stateVersion: item.stateVersion, code: item.code, applicant: item.name,
        amountCents: selectedTotal, itemIds: selectedIds, bundleId: item.bundleId });
      materials.push(...prepared);
      if (!allowLegacy) materialGroups.push(...prepared.map(({ bytes: _bytes, sources: _sources, ...metadata }) => metadata));
      bundle.sources.forEach((source, index) => {
        if (source.preview === 'original-only' && (!source.expenseItemId || selectedIds.includes(source.expenseItemId))) unmergedAttachments.push({ requestId: item.id, name: bundle.downloadNames?.[index] || source.name,
          sha256: source.sha256, url: `${apiRoot}/bundles/${bundle.id}/original/${index}` });
      });
      for (const source of bundle.sources) {
        if (source.expenseItemId && !selectedIds.includes(source.expenseItemId)) continue;
        const owners = hashOwners.get(source.sha256) || new Set(); owners.add(item.code); hashOwners.set(source.sha256, owners);
      }
    }
    const rowKeys = new Set(rows.flatMap(row => row.origins.map(o => financeKey(o.requestId, o.itemId))));
    if ([...settlements.keys()].some(key => !rowKeys.has(key))) throw summaryFailure('核定金额包含未选择的条目。');
    if (rows.length > SUMMARY_LIMITS.rows) throw summaryFailure('所选明细超过 200 项，请分批汇总。', 413);
    const arranged = arrangeSummary(rows, materials, body.itemOrder);
    const orderedMaterials = activityReview || body.itemOrder !== undefined ? arranged.materials : materials;
    let resultRows = arranged.rows;
    if (activityReview && body.mergeSameItems) throw summaryFailure('活动终审保留逐项材料对应关系，请勿合并同名条目。');
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
    const outstanding = outstandingFor(activity.id, selections);
    return { summary: { protocolVersion: activityReview ? 2 : 1, activity: structuredClone(activity), form, selections, rows: resultRows,
      itemOrder: arranged.itemOrder, outstanding,
      mergeSameItems: Boolean(body.mergeSameItems), totalCents, amountUpper: chineseAmount(totalCents), attachmentPages: pageCount, duplicateMaterials,
      ...(!allowLegacy ? { materialsOrder: activityReview || body.itemOrder !== undefined ? 'expense-order-invoice-order-payment-other' : 'request-expense-invoice-order-payment-other', materialGroups: orderedMaterials.map(material => materialGroups.find(group => group.requestId === material.requestId && group.groupIndex === material.groupIndex)) } : {}),
      ...(unmergedAttachments.length ? { unmergedAttachments } : {}) }, materials: orderedMaterials };
  }
  function outstandingFor(activityId, selections) {
    const selected = new Set(selections.flatMap(s => (s.itemIds || requests.get(s.requestId)?.expenseItems.map(row => row.id) || [])
      .map(itemId => financeKey(s.requestId, itemId))));
    return [...requests.values()].flatMap(request => {
      const itemIds = (request.expenseItems || []).filter(item => itemActivityId(request, item) === activityId
        && !itemFinalReview(request, item) && !selected.has(financeKey(request.id, item.id))).map(item => item.id);
      return itemIds.length ? [{ requestId: request.id, code: request.code, status: request.status, itemIds }] : [];
    });
  }
  const root = `${apiRoot}/summaries`;
  function publicSummary(item) {
    const manifest = Object.fromEntries(Object.keys(item).filter(key => !['formPdf', 'packetPdf'].includes(key)).map(key => [key, item[key]]));
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
      if (summaries.size >= limits.summaries) throw summaryFailure('汇总数量已达容量上限。', 413);
      const { summary, materials } = build(actor, body);
      if (!activityReview && summary.duplicateMaterials.length && body.duplicateMaterialsConfirmed !== true) throw summaryFailure('申请中存在字节相同的材料，请核对后勾选重复材料确认。');
      const item = { ...summary, id: randomUUID(), code: `HZ-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: now(), actor: actor.id,
        ...(activityReview ? { status: 'draft', stateVersion: 1 } : {}),
        duplicateMaterialsConfirmed: body.duplicateMaterialsConfirmed === true };
      const files = await generate(item, materials);
      reserveBytes(files.formPdf.length + files.packetPdf.length);
      Object.assign(item, files); summaries.set(item.id, item);
      if (!activityReview) for (const selection of item.selections) claims.set(`${selection.requestId}:${selection.revision}`, item.id);
      receipts.set(receiptKey, { fingerprint, id: item.id });
      return { ok: true, summary: publicSummary(item) };
    });
  }
  function get(actor, id) {
    reader(actor); const item = summaries.get(id); if (!item) throw summaryFailure('汇总记录不存在。', 404); return item;
  }
  function review(actor, id, body) {
    reviewer(actor);
    return queue(() => {
      const item = get(actor, id);
      objectFields(body, ['action', 'stateVersion', 'materialsChecked', 'scopeConfirmed', 'note'], '活动终审');
      if (!activityReview || item.protocolVersion !== 2 || item.status !== 'draft' || item.stateVersion !== body.stateVersion)
        throw summaryFailure('汇总状态已变化，请刷新后重新处理。', 409);
      if (!['approve', 'return'].includes(body.action)) throw summaryFailure('请选择终审通过或退回初审。');
      const note = checkedText(body.note, '审核意见', 1000, body.action === 'approve');
      if (body.action === 'approve' && (body.materialsChecked !== true || body.scopeConfirmed !== true)) throw summaryFailure('请确认已核对完整 PDF 和本次活动的申请范围。');
      if (activities.get(item.activity.id)?.revision !== item.activity.revision) throw summaryFailure('活动资料已变化，请重新生成材料。', 409);
      const selected = item.selections.map(selection => {
        const request = requests.get(selection.requestId);
        if (!request || !eligibility(request).eligible || request.revision !== selection.revision || request.stateVersion !== selection.stateVersion
          || request.bundleId !== selection.bundleId) throw summaryFailure('申请或材料版本已变化，请重新生成材料。', 409);
        if (requireDistinctReviewers && request.initialReview.actor === actor.id) throw summaryFailure('同一申请须由不同人员完成初审与终审。', 403);
        return request;
      });
      // A newly submitted application changes the scope shown in the preview.
      const outstanding = outstandingFor(item.activity.id, item.selections);
      if (JSON.stringify(outstanding) !== JSON.stringify(item.outstanding)) throw summaryFailure('本活动的申请范围已变化，请重新生成材料。', 409);
      const at = now(), passing = body.action === 'approve';
      for (const request of selected) {
        const selection = item.selections.find(s => s.requestId === request.id);
        if (passing) for (const expense of request.expenseItems.filter(row => (selection.itemIds || request.expenseItems.map(e => e.id)).includes(row.id))) {
          if (itemFinalReview(request, expense) || itemActivityId(request, expense) !== item.activity.id) throw summaryFailure('条目归属或审核状态已变化，请重新生成材料。', 409);
        }
      }
      for (const request of selected) {
        const selection = item.selections.find(s => s.requestId === request.id);
        if (passing) for (const expense of request.expenseItems.filter(row => (selection.itemIds || request.expenseItems.map(e => e.id)).includes(row.id))) {
          const origin = item.rows.flatMap(row => row.origins).find(o => o.requestId === request.id && o.itemId === expense.id);
          financeRecord(request, expense).finalReview = { actor: actor.id, at, note, revision: request.revision, bundleId: request.bundleId,
            summaryId: item.id, amountCents: origin.amountCents, reason: origin.reason || '' };
        }
        request.status = passing ? 'final_pending' : 'initial_returned';
        request.finalReview = null; syncFinanceRequest(request);
        request.stateVersion++; request.updatedAt = at;
        request.history.push({ action: passing ? 'final-approve' : 'final-return', actor: actor.id, at, note,
          revision: request.revision, stateVersion: request.stateVersion, bundleId: request.bundleId, summaryId: item.id,
          ...(passing ? { materialsChecked: true } : {}) });
        if (passing && request.status === 'approved') claims.set(`${request.id}:${request.revision}`, item.id);
      }
      item.status = passing ? 'approved' : 'returned'; item.stateVersion++;
      if (passing) item.duplicateMaterialsConfirmed = true;
      item.finalReview = { actor: actor.id, at, note }; return { ok: true, summary: publicSummary(item) };
    });
  }
  function list(actor) { reader(actor); return { ok: true, summaries: [...summaries.values()].reverse().map(publicSummary) }; }
  function download(actor, id, kind) {
    const item = get(actor, id);
    if (!['form', 'packet'].includes(kind)) throw summaryFailure('汇总文件不存在。', 404);
    return { name: `${item.activity.name}-${kind === 'form' ? '活动费报销表' : '完整报销材料'}-${item.code}.pdf`, bytes: Buffer.from(kind === 'form' ? item.formPdf : item.packetPdf) };
  }
  return { eligibility, listActivities, saveActivity, validateActivity, preview, create, review, list, download,
    activityName: id => activities.get(id)?.name || '',
    get: (actor, id) => ({ ok: true, summary: publicSummary(get(actor, id)) }) };
}
