import { randomUUID, createHash } from 'node:crypto';
import { createMutationQueue } from '../events/safety.js';
import { processMaterialPdfs } from './processor.js';
import { processLocalAnalysis } from './analysis-processor.js';
import { normalizeExpenses, checkedDate, checkedText, objectFields } from './summary-contract.js';
import { createLocalSummaries } from './local-summary.js';
import { createLocalItemPackets } from './local-item-packets.js';
import { financePermissions, WORKFLOW_STATUSES, createReimbursementWorkflow } from './workflow.js';
import { createLocalPayments, paymentEligibility } from './local-payment.js';
import { createLocalLedger } from './local-ledger.js';
import { UPLOAD_LIMITS, MB } from '../../public/app/shared/reimbursement-limits.js';
import { materialFilename, mergedFilename, requestMaterialFilename, materialContentType, MATERIAL_KINDS, SUPPORTING_MATERIAL_TYPES } from '../../public/app/shared/reimbursement-files.js';
import { bankAccountError } from '../../public/app/shared/reimbursement-bank-account.js';
import { createReimbursementState, LOCAL_LIMITS } from './state.js';
import { initialAssignment, assertInitialAssignment, mayReadFinanceRequest } from './review-routing.js';
import { createReimbursementNotifications } from './notifications.js';
import { normalizeInitialEdits } from './initial-edits.js';
import { createFinanceWorkspace } from './finance-workspace.js';
import { assertFrozenExpenses, applyRequestActivityCorrection } from './finance-items.js';
import { reimbursementMaterialIssues } from '../../public/app/shared/reimbursement-material-rules.js';
import { recentReimbursementActivities } from '../../public/app/shared/reimbursement-activities.js';

export const REIMBURSEMENT_NOTICE = '本地演示：材料与审核记录仅保存在本次服务内存中，重启后清空。暂未发送邮件。';
export const STATUSES = Object.freeze({ pending: '待审核', returned: '待补充', approved: '审核通过' });
function fail(statusCode, message, code = 'reimbursement_validation') { throw Object.assign(new Error(message), { statusCode, code }); }
function text(value, name, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `请填写${name}，不超过 ${max} 个字符。`);
  return value.trim();
}
export function amountCents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) fail(400, '报销金额须为正数，最多保留两位小数。');
  const [yuan, fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1) fail(400, '报销金额须大于 0。');
  return cents;
}

/** A repository-independent local workflow; owner/reviewer checks are retained for a future persistent adapter. */
export function createLocalReimbursementService({ processFiles = processMaterialPdfs, analyzePage = processLocalAnalysis, generateSummary, generatePackets,
  workflowVersion = 3, requireDistinctReviewers = false, now = () => new Date().toISOString(),
  state = createReimbursementState(), apiRoot = '/api/preview/reimbursements', local = true, limits = LOCAL_LIMITS, requireMaterialRules = false } = {}) {
  if (![1, 2, 3].includes(workflowVersion) || typeof requireDistinctReviewers !== 'boolean') throw new Error('Invalid local workflow configuration');
  const queue = createMutationQueue(), { bundles, requests, receipts } = state;
  const analysisQueue = createMutationQueue(), analysesPending = new Map();
  const capacity = limits.bytes;
  const actorId = actor => text(actor?.id, '登录身份', 160);
  const permissionsFor = actor => workflowVersion === 1 && actor?.canReview === true ? ['initial', 'final', 'view'] : financePermissions(actor);
  const requirePermission = (actor, permission) => { actorId(actor); if (!permissionsFor(actor).includes(permission)) fail(403, '需要对应的财务审核权限。'); };
  const reviewer = actor => { actorId(actor); if (!permissionsFor(actor).length) fail(403, '需要报销审核权限。'); };
  const canRead = (actor, item) => mayReadFinanceRequest(actor, item, permissionsFor(actor));
  const notifications = createReimbursementNotifications({ jobs: state.notificationJobs, requests, bundles, queue, now });
  const finalReviewer = actor => requirePermission(actor, 'final');
  const summaryReader = actor => { reviewer(actor); if (workflowVersion === 3 && !permissionsFor(actor).some(p => ['final', 'view'].includes(p))) fail(403, '需要活动终审或财务查看权限。'); };
  const summaryService = createLocalSummaries({ requests, bundles, queue, actorId, reviewer: finalReviewer, reader: summaryReader, now,
    activityReview: workflowVersion === 3, requireDistinctReviewers,
    activities: state.activities, summaries: state.summaries, claims: state.claims, receipts: state.summaryReceipts, apiRoot, limits,
    allowLegacy: workflowVersion === 1, hasFinanceAccess: actor => permissionsFor(actor).length > 0,
    materialsFor: (actor, item) => materialPackets.summaryMaterials(actor, item.id),
    ...(generateSummary ? { generate: generateSummary } : {}), reserveBytes: bytes => {
      if (state.storedBytes + bytes > capacity) fail(413, '材料存储容量已满，请联系管理员处理。');
      state.storedBytes += bytes;
    } });
  function bundleSummary(bundle, overrideRequest = null) {
    const request = overrideRequest || [...requests.values()].find(item => item.bundleId === bundle.id);
    const names = request ? bundle.files.map((file, index) => requestMaterialFilename(request, file, index, bundle.files)) : bundle.downloadNames;
    const sources = bundle.sources.map((source, index) => ({ ...source, name: names?.[index] || source.name }));
    return { id: bundle.id, pageCount: bundle.pageCount, sources, createdAt: bundle.createdAt,
      analyses: structuredClone(bundle.analyses || []),
      mergedName: currentMergedName(bundle, request, names),
      mergedUrl: bundle.pageCount ? `${apiRoot}/bundles/${bundle.id}/merged` : null,
      originalUrls: bundle.files.map((file, index) => ({ name: names?.[index] || file.name, originalName: file.name,
        size: bundle.sources[index]?.originalBytes ?? null,
        kind: file.kind, expenseItemId: file.expenseItemId, materialType: file.materialType,
        url: `${apiRoot}/bundles/${bundle.id}/original/${index}` })) };
  }
  function currentMergedName(bundle, request, names) {
    if (!request || !bundle.files.some(file => ['invoice', 'supporting'].includes(file.kind))) return bundle.mergedName || '报销材料合并.pdf';
    if (bundle.files.length === 1 && bundle.files[0].kind === 'invoice') return names[0];
    return mergedFilename({ name: request.name, label: request.expenseItems?.length === 1 ? request.expenseItems[0].label : request.purpose,
      amount: (request.amountCents / 100).toFixed(2) });
  }
  function requestSummary(item) {
    return structuredClone({ ...item, activityName: item.activityNameSnapshot || summaryService.activityName(item.activityId),
      statusLabel: item.workflowVersion >= 2 ? item.paymentStatus === 'paid' ? '已打款' : WORKFLOW_STATUSES[item.status] : item.status === 'approved' && workflowVersion >= 2 ? '原审核通过（旧流程待核查）' : STATUSES[item.status],
      ...(item.workflowVersion >= 2 ? { paymentEligibility: paymentEligibility(item) } : {}),
      notificationStatuses: notifications.statuses(item.id), summaryEligibility: summaryService.eligibility(item), bundle: bundleSummary(bundles.get(item.bundleId)) });
  }
  function target(id, actor, reviewing = false) {
    actorId(actor); if (reviewing) reviewer(actor);
    const item = requests.get(id);
    if (!item || (!reviewing && item.owner !== actor.id) || reviewing && !canRead(actor, item)) fail(404, '申请不存在。');
    return item;
  }
  const materialPackets = createLocalItemPackets({ queue, target, bundles, bundleSummary, now,
    sets: state.packetSets, apiRoot, limits,
    workflowVersion, authorizeGenerate: actor => requirePermission(actor, 'initial'),
    ...(generatePackets ? { generate: generatePackets } : {}), reserveBytes: bytes => {
      if (state.storedBytes + bytes > capacity) fail(413, '材料存储容量已满，请联系管理员处理。');
      state.storedBytes += bytes;
    } });
  const workflow = createReimbursementWorkflow({ queue, target, requirePermission, packets: materialPackets, now, requireDistinctReviewers, authorizeInitial: assertInitialAssignment,
    prepareEdits: (item, body) => {
      const edits = normalizeInitialEdits(item, body, { activities: state.activities, parseAmount: amountCents });
      if (edits) { const issues = reimbursementMaterialIssues({ ...item, ...edits.patch }, bundles.get(item.bundleId).files);
        if (issues.length) fail(400, `${issues.join(' ')}请退回申请人补充所需材料。`); }
      return edits;
    },
    onEdited: item => {
      const bundle = bundles.get(item.bundleId);
      bundle.downloadNames = bundle.files.map((file, index) => requestMaterialFilename(item, file, index, bundle.files));
      bundle.mergedName = currentMergedName(bundle, item, bundle.downloadNames);
    },
    onInitialApproved: item => { if (item.workflowVersion === 3) notifications.enqueue(item, 'final'); },
    onInitialReturned: item => notifications.enqueue(item, 'applicant-return') });
  const payments = createLocalPayments({ queue, target, requirePermission, parseAmount: amountCents, now, receipts: state.paymentReceipts, limits });
  const finance = createFinanceWorkspace({ state, queue, requirePermission, permissionsFor, now, limits, apiRoot });
  const ledger = createLocalLedger({ requests, bundles, reviewer, canRead, activityName: (id, item) => item?.activityNameSnapshot || summaryService.activityName(id),
    activities: state.activities, summaries: state.summaries,
    mayExport: actor => permissionsFor(actor).some(permission => ['final', 'view'].includes(permission)),
    mayPay: actor => permissionsFor(actor).includes('payment') });
  async function preprocess(actor, files, revisionSource = null) {
    actorId(actor);
    return queue(async () => {
      let retainedFrom;
      if (revisionSource !== null) {
        objectFields(revisionSource, ['requestId', 'revision', 'stateVersion', 'bundleId', 'entries'], '补充材料来源');
        const item = target(revisionSource.requestId, actor);
        if (item.status !== 'returned' || item.revision !== revisionSource.revision || item.stateVersion !== revisionSource.stateVersion
          || item.bundleId !== revisionSource.bundleId) fail(409, '原申请状态或材料版本已变化，请重新打开后补充。');
        if (!Array.isArray(files) || !Array.isArray(revisionSource.entries) || !revisionSource.entries.length || revisionSource.entries.length > UPLOAD_LIMITS.files)
          fail(400, '请保留或上传有效材料。');
        const source = bundles.get(item.bundleId), usedOriginals = new Set(), usedUploads = new Set();
        const uploads = files;
        files = revisionSource.entries.map(entry => {
          objectFields(entry, ['originalIndex', 'uploadIndex', 'expenseItemId', 'materialType'], '补充材料条目');
          const original = Object.hasOwn(entry, 'originalIndex'), index = original ? entry.originalIndex : entry.uploadIndex;
          if (original === Object.hasOwn(entry, 'uploadIndex') || !Number.isSafeInteger(index) || index < 0) fail(400, '材料来源不正确。');
          const used = original ? usedOriginals : usedUploads;
          if (used.has(index)) fail(400, '不能重复引用同一份材料。'); used.add(index);
          const file = (original ? source?.files : uploads)?.[index];
          if (!file) fail(400, '引用的原件或新文件不存在。');
          // bytes is loaded through the checksum-verified Box codec, never from a caller-supplied URL.
          return { ...file, bytes: Buffer.from(file.bytes), expenseItemId: entry.expenseItemId ?? file.expenseItemId,
            materialType: entry.materialType ?? file.materialType };
        });
        if (usedUploads.size !== uploads.length) fail(400, '存在未关联的新上传材料。');
        retainedFrom = Object.fromEntries(['requestId', 'revision', 'stateVersion', 'bundleId'].map(key => [key, revisionSource[key]]));
      }
      if (!Array.isArray(files) || !files.length || files.length > UPLOAD_LIMITS.files) fail(400, `请上传 1 至 ${UPLOAD_LIMITS.files} 份材料。`);
      if (files.some(file => !file.bytes?.length || file.bytes.length > UPLOAD_LIMITS.fileMB * MB)) fail(400, `单个文件不能超过 ${UPLOAD_LIMITS.fileMB} MB。`);
      if (files.reduce((sum, file) => sum + file.bytes.length, 0) > UPLOAD_LIMITS.totalMB * MB) fail(400, `材料总大小不能超过 ${UPLOAD_LIMITS.totalMB} MB。`);
      const originals = files.map(file => {
        const kind = file.kind || 'legacy';
        if (!Object.hasOwn(MATERIAL_KINDS, kind)) fail(400, '材料类型不正确。');
        if (file.expenseItemId !== undefined && (typeof file.expenseItemId !== 'string' || file.expenseItemId.length > 80)) fail(400, '材料关联的支出项目不正确。');
        if (file.materialType !== undefined && (typeof file.materialType !== 'string' || file.materialType.length > 40)) fail(400, '补充材料类型选择不正确。');
        if (file.materialType && (kind !== 'supporting' || !SUPPORTING_MATERIAL_TYPES.includes(file.materialType))) fail(400, '补充材料类型选择不正确。');
        return { name: String(file.name).replace(/[\r\n\x00]/g, '').slice(0, 180), bytes: Buffer.from(file.bytes),
          kind, expenseItemId: file.expenseItemId || '', materialType: file.materialType || '' };
      });
      const sourceBytes = originals.reduce((sum, file) => sum + file.bytes.length, 0);
      if (bundles.size >= limits.bundles || state.storedBytes + sourceBytes * 2 > capacity) fail(413, '材料存储容量已满，请联系管理员处理。');
      const result = await processFiles(originals);
      const bytes = sourceBytes + result.merged.length;
      if (state.storedBytes + bytes > capacity) fail(413, '材料存储容量已满，请联系管理员处理。');
      const bundle = { ...result, sources: result.sources.map((source, index) => ({ ...source,
        originalBytes: originals[index].bytes.length,
        sha256: createHash('sha256').update(originals[index].bytes).digest('hex'), originalName: originals[index].name,
        kind: originals[index].kind, expenseItemId: originals[index].expenseItemId, materialType: originals[index].materialType })),
      id: randomUUID(), owner: actor.id, files: originals, createdAt: now(), ...(retainedFrom ? { retainedFrom } : {}) };
      bundles.set(bundle.id, bundle); state.storedBytes += bytes;
      return { ok: true, bundle: bundleSummary(bundle) };
    });
  }
  function attachment(actor, id, originalIndex = null) {
    actorId(actor); const bundle = bundles.get(id);
    // A reviewer only gains access to attachments after their owner actually submits them.
    const submitted = [...requests.values()].some(item => item.bundleId === id || item.history.some(event => event.bundleId === id));
    const financeAccess = [...requests.values()].some(item => (item.bundleId === id || item.history.some(event => event.bundleId === id)) && canRead(actor, item));
    if (!bundle || (bundle.owner !== actor.id && !(submitted && financeAccess))) fail(404, '材料不存在。');
    const request = [...requests.values()].find(item => item.bundleId === id);
    const names = request ? bundle.files.map((file, index) => requestMaterialFilename(request, file, index, bundle.files)) : bundle.downloadNames;
    if (originalIndex === null) {
      if (!bundle.pageCount) fail(404, '本申请仅含 Word 原件，请分别下载核对。');
      return { bytes: bundle.merged, name: currentMergedName(bundle, request, names), contentType: 'application/pdf' };
    }
    if (!Number.isInteger(originalIndex) || originalIndex < 0 || !bundle.files[originalIndex]) fail(404, '原文件不存在。');
    return { ...bundle.files[originalIndex], name: names?.[originalIndex] || bundle.files[originalIndex].name,
      contentType: materialContentType(bundle.files[originalIndex].name) };
  }
  async function analyze(actor, id, page) {
    attachment(actor, id); // Check ownership/reviewer access before returning cached hints.
    const bundle = bundles.get(id);
    if (!Number.isInteger(page) || page < 1 || page > bundle.pageCount) fail(400, '请选择有效的材料页码。');
    const cached = bundle.analyses?.find(item => item.page === page);
    if (cached) return { ok: true, cached: true, analysis: structuredClone(cached) };
    const key = `${id}:${page}`;
    if (!analysesPending.has(key)) {
      if (analysesPending.size >= 3) fail(429, '本地识别正在处理其他页面，请稍后重试。');
      const task = analysisQueue(async () => {
        const source = bundle.sources.find(item => page >= item.startPage && page <= item.endPage);
        if (source.kind === 'supporting' && !['订单截图', '付款截图', '订单和付款截图'].includes(source.materialType))
          fail(400, '此类补充材料请查看原件，暂不进行自动核验。');
        const localPage = page - source.startPage + 1, index = bundle.sources.indexOf(source);
        const result = await analyzePage({ bytes: bundle.files[index].bytes, pageNumber: localPage,
          materialKind: source.kind, materialType: source.materialType, originalName: bundle.files[index].name,
          previousCheck: source.checks.find(check => check.page === localPage) });
        const analysis = { ...result, page, sourcePage: localPage, sourceName: source.originalName || source.name,
          materialKind: source.kind, materialType: source.materialType, at: now() };
        bundle.analyses ||= []; bundle.analyses.push(analysis);
        return { ok: true, analysis: structuredClone(analysis) };
      }).finally(() => analysesPending.delete(key));
      analysesPending.set(key, task);
    }
    return analysesPending.get(key);
  }
  function submit(actor, body, id = null) {
    actorId(actor);
    return queue(async () => {
      const name = text(body.name, '姓名', 50), purpose = text(body.purpose, '报销事由', 500);
      const payment = {};
      if (body.bankAccount !== undefined) {
        const error = bankAccountError(body.bankAccount);
        if (error) fail(400, error);
        payment.bankAccount = body.bankAccount;
      }
      const amount = amountCents(body.amount);
      if (!id && requireMaterialRules && body.materialRulesVersion !== 1) fail(400, '请刷新申请页面，按报销类别及材料规范提交新申请。');
      if (body.materialRulesVersion !== undefined && body.materialRulesVersion !== 1) fail(400, '报销材料规则版本不正确。');
      const materialRules = body.materialRulesVersion === 1 ? { materialRulesVersion: 1, singleOrderConfirmed: body.singleOrderConfirmed, meetingRelated: body.meetingRelated } : {};
      if (id && requests.get(id)?.materialRulesVersion === 1 && body.materialRulesVersion !== 1) fail(400, '补充申请须保留当前材料规范。');
      const expenses = normalizeExpenses(body, amountCents);
      if (!id && requireMaterialRules && expenses.expenseItems.some(item => item.category === '火车票/高铁票' && !item.railJourney))
        fail(400, '火车票报销请填写出发站、到达站及单程或往返，用于原件命名。');
      const expenseDate = body.expenseDate ? checkedDate(body.expenseDate, '活动日期') : '';
      const voucherNote = checkedText(body.voucherNote, '特殊情况说明', 1000, true);
      if (expenses.activityId) summaryService.validateActivity(expenses.activityId);
      const assignment = workflowVersion === 3 ? initialAssignment(state.activities.get(expenses.activityId)) : null;
      const key = text(body.idempotencyKey, '操作标识', 160);
      const bundle = bundles.get(body.bundleId);
      if (!bundle || bundle.owner !== actor.id) fail(404, '请选择属于本账号的材料。');
      const materialIssues = reimbursementMaterialIssues({ ...body, ...materialRules, expenseItems: expenses.expenseItems }, bundle.files);
      if (materialIssues.length) fail(400, materialIssues.join(' '));
      if (bundle.retainedFrom && bundle.retainedFrom.requestId !== id) fail(409, '补充材料只能用于原申请。');
      const downloadNames = bundle.files.map((file, index) => {
        if (file.kind === 'legacy') return file.name;
        const expense = expenses.expenseItems.find(row => row.id === file.expenseItemId);
        if ((file.kind === 'invoice' || file.expenseItemId) && !expense) fail(400, '请为每份发票选择有效的支出项目，补充材料的关联项目也须存在。');
        return materialFilename({ name, category: expense?.category || '其他', railJourney: expense?.railJourney, purpose, label: expense?.label || purpose, kind: file.kind,
          index: file.kind === 'supporting' ? bundle.files.slice(0, index).filter(entry => entry.kind === 'supporting').length : index,
          originalName: file.name, materialType: file.materialType || '',
          amount: ((expense?.amountCents ?? amount) / 100).toFixed(2) });
      });
      const fingerprint = JSON.stringify({ owner: actor.id, id, name, purpose, amount, bundleId: bundle.id, expenseDate, voucherNote, ...expenses, ...payment });
      const receiptKey = `${actor.id}:${key}`, repeated = receipts.get(receiptKey);
      if (repeated) {
        if (repeated.fingerprint !== fingerprint) fail(409, '同一操作标识不能用于不同申请内容。');
        return { ok: true, duplicate: true, request: requestSummary(requests.get(repeated.id)) };
      }
      let item;
      if (id) {
        item = structuredClone(target(id, actor));
        if (item.status !== 'returned') fail(409, '只有待补充的申请可以重新提交。');
        const expected = bundle.retainedFrom || body;
        if ((expected.revision !== undefined && expected.revision !== item.revision)
          || (expected.stateVersion !== undefined && expected.stateVersion !== item.stateVersion)
          || (bundle.retainedFrom && expected.bundleId !== item.bundleId)) fail(409, '原申请状态或材料版本已变化，请重新打开后补充。');
        assertFrozenExpenses(item, expenses.expenseItems, fail);
        if (item.bundleId === bundle.id) fail(400, '请重新整理并上传补充后的材料。');
      } else {
        if ([...requests.values()].some(item => item.bundleId === bundle.id)) fail(409, '这份材料已提交，请查看现有申请。');
        if (requests.size >= limits.requests) fail(413, '申请数量已达容量上限，请联系管理员处理。');
        item = { id: randomUUID(), code: `BX-${randomUUID().slice(0, 8).toUpperCase()}`, owner: actor.id, history: [], revision: 0, createdAt: now() };
      }
      if (body.materialRulesVersion === 1 && (!id || expenses.activityId !== item.activityId)
        && !recentReimbursementActivities([state.activities.get(expenses.activityId)], new Date(now())).length) fail(400, '新申请仅可关联近 30 天内且已登记校区的活动；补充申请可保留原活动。');
      Object.assign(item, { name, purpose, amountCents: amount, bundleId: bundle.id, expenseDate, voucherNote, ...expenses, ...materialRules, ...payment, status: 'pending', updatedAt: now(), revision: item.revision + 1 });
      if (workflowVersion >= 2) Object.assign(item, { workflowVersion, stateVersion: (item.stateVersion || 0) + 1,
        initialReview: null, finalReview: null, paymentStatus: 'not-ready' });
      bundle.downloadNames = downloadNames;
      const singleExpense = expenses.expenseItems.length === 1 ? expenses.expenseItems[0] : null;
      bundle.mergedName = bundle.files.length === 1 && bundle.files[0].kind === 'invoice' ? downloadNames[0]
        : mergedFilename({ name, label: singleExpense?.label || purpose, amount: (amount / 100).toFixed(2) });
      item.history.push({ action: id ? 'resubmit' : 'submit', actor: actor.id, at: now(), bundleId: bundle.id, revision: item.revision });
      if (workflowVersion === 3) {
        item.initialAssignment = assignment; item.activityNameSnapshot = state.activities.get(item.activityId).name;
        await materialPackets.prepare(item);
        notifications.enqueue(item, 'initial');
      }
      requests.set(item.id, item); receipts.set(receiptKey, { fingerprint, id: item.id });
      return { ok: true, request: requestSummary(item) };
    });
  }
  function review(actor, id, body) {
    if (workflowVersion >= 2) return workflow.review(actor, id, body).then(result => ({ ok: true, request: requestSummary(result.item) }));
    reviewer(actor);
    return queue(() => {
      const item = target(id, actor, true);
      if (item.status !== 'pending' || item.revision !== body.revision) fail(409, '申请状态或材料版本已变化，请刷新后审核。');
      if (!['approve', 'return'].includes(body.action)) fail(400, '请选择通过或退回补充。');
      const note = body.action === 'return' ? text(body.note, '退回原因', 1000) : String(body.note || '').trim();
      if (note.length > 1000) fail(400, '审核意见不能超过 1000 个字符。');
      if (body.action === 'approve' && body.materialsChecked !== true) fail(400, '通过前须人工确认原材料与申请金额。');
      const reviewedAt = now();
      item.status = body.action === 'approve' ? 'approved' : 'returned'; item.updatedAt = reviewedAt;
      item.history.push({ action: body.action, actor: actor.id, at: reviewedAt, note, revision: item.revision,
        ...(body.action === 'approve' ? { materialsChecked: true } : {}) });
      return { ok: true, request: requestSummary(item) };
    });
  }
  function list(actor, reviewing = false) {
    actorId(actor); if (reviewing) reviewer(actor);
    return { ok: true, local, notice: local ? REIMBURSEMENT_NOTICE : '', requests: [...requests.values()]
      .filter(item => reviewing ? canRead(actor, item) : item.owner === actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(requestSummary) };
  }
  function editRequest(actor, id, body) {
    requirePermission(actor, 'final');
    return queue(() => {
      objectFields(body, ['revision', 'stateVersion', 'changes'], '终审修改');
      const item = target(id, actor, true);
      if (item.workflowVersion !== 3 || item.status !== 'final_pending' || item.initialReview?.revision !== item.revision
        || item.initialReview?.bundleId !== item.bundleId) fail(409, '仅本版初审通过、待终审的申请可以修改。');
      if (item.revision !== body.revision || item.stateVersion !== body.stateVersion) fail(409, '申请状态或版本已变化，请刷新后修改。');
      const edits = normalizeInitialEdits(item, body.changes, { activities: state.activities, parseAmount: amountCents, label: '终审修改' });
      if (!edits) return { ok: true, request: requestSummary(item) };
      assertFrozenExpenses(item, edits.patch.expenseItems, fail);
      const issues = reimbursementMaterialIssues({ ...item, ...edits.patch }, bundles.get(item.bundleId).files);
      if (issues.length) fail(400, `${issues.join(' ')}请退回申请人补充所需材料。`);
      materialPackets.updateMetadata({ ...item, ...edits.patch }, item.initialReview.actor);
      applyRequestActivityCorrection(item, edits.patch.activityId);
      Object.assign(item, edits.patch);
      const bundle = bundles.get(item.bundleId);
      bundle.downloadNames = bundle.files.map((file, index) => requestMaterialFilename(item, file, index, bundle.files));
      bundle.mergedName = currentMergedName(bundle, item, bundle.downloadNames);
      item.stateVersion++; item.updatedAt = now();
      item.history.push({ action: 'finance-request-edited', actor: actor.id, at: item.updatedAt, revision: item.revision,
        stateVersion: item.stateVersion, bundleId: item.bundleId, changes: edits.audit });
      return { ok: true, request: requestSummary(item) };
    });
  }
  return { preprocess, attachment, analyze, submit, review, editRequest, list, notifications, summaries: summaryService, materialPackets, ledger, finance,
    registerPayment: (actor, id, body) => payments.register(actor, id, body).then(result => ({ ok: true, local: true,
      ...(result.duplicate ? { duplicate: true } : {}), request: requestSummary(result.item) })),
    workflowInfo: actor => ({ version: workflowVersion, permissions: permissionsFor(actor), requireDistinctReviewers,
      activityReview: workflowVersion === 3, financeWorkspace: workflowVersion === 3, requestEditing: workflowVersion === 3, retainedMaterials: true,
      paymentRegistration: workflowVersion >= 2, ledger: workflowVersion >= 2, exports: workflowVersion >= 2 }),
    get: (actor, id, reviewing = false) => ({ ok: true, request: requestSummary(target(id, actor, reviewing)) }) };
}
