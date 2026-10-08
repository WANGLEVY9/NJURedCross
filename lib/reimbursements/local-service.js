import { randomUUID, createHash } from 'node:crypto';
import { createMutationQueue } from '../events/safety.js';
import { processMaterialPdfs } from './processor.js';
import { processLocalAnalysis } from './analysis-processor.js';
import { normalizeExpenses, checkedDate, checkedText } from './summary-contract.js';
import { createLocalSummaries } from './local-summary.js';
import { UPLOAD_LIMITS, MB } from '../../public/app/shared/reimbursement-limits.js';

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
export function createLocalReimbursementService({ processFiles = processMaterialPdfs, analyzePage = processLocalAnalysis, generateSummary, now = () => new Date().toISOString() } = {}) {
  const queue = createMutationQueue(), bundles = new Map(), requests = new Map(), receipts = new Map();
  const analysisQueue = createMutationQueue(), analysesPending = new Map();
  let storedBytes = 0;
  const capacity = 500 * MB;
  const actorId = actor => text(actor?.id, '登录身份', 160);
  const reviewer = actor => { actorId(actor); if (actor?.canReview !== true) fail(403, '需要报销审核权限。'); };
  const summaryService = createLocalSummaries({ requests, bundles, queue, actorId, reviewer, now,
    ...(generateSummary ? { generate: generateSummary } : {}), reserveBytes: bytes => {
      if (storedBytes + bytes > capacity) fail(413, '本地材料存储已满，请结束本轮演示并重启服务。');
      storedBytes += bytes;
    } });
  function bundleSummary(bundle) {
    return { id: bundle.id, pageCount: bundle.pageCount, sources: bundle.sources, createdAt: bundle.createdAt,
      analyses: structuredClone(bundle.analyses || []),
      mergedUrl: `/api/preview/reimbursements/bundles/${bundle.id}/merged`,
      originalUrls: bundle.files.map((file, index) => ({ name: file.name, url: `/api/preview/reimbursements/bundles/${bundle.id}/original/${index}` })) };
  }
  function requestSummary(item) {
    return structuredClone({ ...item, activityName: summaryService.activityName(item.activityId), statusLabel: STATUSES[item.status], summaryEligibility: summaryService.eligibility(item), bundle: bundleSummary(bundles.get(item.bundleId)) });
  }
  function target(id, actor, reviewing = false) {
    actorId(actor); if (reviewing) reviewer(actor);
    const item = requests.get(id);
    if (!item || (!reviewing && item.owner !== actor.id)) fail(404, '申请不存在。');
    return item;
  }
  async function preprocess(actor, files) {
    actorId(actor);
    return queue(async () => {
      if (!Array.isArray(files) || !files.length || files.length > UPLOAD_LIMITS.files) fail(400, `请上传 1 至 ${UPLOAD_LIMITS.files} 个 PDF。`);
      if (files.some(file => !file.bytes?.length || file.bytes.length > UPLOAD_LIMITS.fileMB * MB)) fail(400, `单个 PDF 不能超过 ${UPLOAD_LIMITS.fileMB} MB。`);
      if (files.reduce((sum, file) => sum + file.bytes.length, 0) > UPLOAD_LIMITS.totalMB * MB) fail(400, `材料总大小不能超过 ${UPLOAD_LIMITS.totalMB} MB。`);
      const originals = files.map(file => ({ name: String(file.name).replace(/[\r\n\x00]/g, '').slice(0, 180), bytes: Buffer.from(file.bytes) }));
      const sourceBytes = originals.reduce((sum, file) => sum + file.bytes.length, 0);
      if (bundles.size >= 30 || storedBytes + sourceBytes * 2 > capacity) fail(413, '本地材料存储已满，请结束本轮演示并重启服务。');
      const result = await processFiles(originals);
      const bytes = sourceBytes + result.merged.length;
      if (storedBytes + bytes > capacity) fail(413, '本地材料存储已满，请结束本轮演示并重启服务。');
      const bundle = { ...result, sources: result.sources.map((source, index) => ({ ...source,
        sha256: createHash('sha256').update(originals[index].bytes).digest('hex') })),
      id: randomUUID(), owner: actor.id, files: originals, createdAt: now() };
      bundles.set(bundle.id, bundle); storedBytes += bytes;
      return { ok: true, bundle: bundleSummary(bundle) };
    });
  }
  function attachment(actor, id, originalIndex = null) {
    actorId(actor); const bundle = bundles.get(id);
    // A reviewer only gains access to attachments after their owner actually submits them.
    const submitted = [...requests.values()].some(item => item.bundleId === id || item.history.some(event => event.bundleId === id));
    if (!bundle || (bundle.owner !== actor.id && !(actor.canReview === true && submitted))) fail(404, '材料不存在。');
    if (originalIndex === null) return { bytes: bundle.merged, name: 'merged-materials.pdf' };
    if (!Number.isInteger(originalIndex) || originalIndex < 0 || !bundle.files[originalIndex]) fail(404, '原文件不存在。');
    return bundle.files[originalIndex];
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
        const localPage = page - source.startPage + 1, index = bundle.sources.indexOf(source);
        const result = await analyzePage({ bytes: bundle.files[index].bytes, pageNumber: localPage,
          previousCheck: source.checks.find(check => check.page === localPage) });
        const analysis = { ...result, page, sourcePage: localPage, sourceName: source.name, at: now() };
        bundle.analyses ||= []; bundle.analyses.push(analysis);
        return { ok: true, analysis: structuredClone(analysis) };
      }).finally(() => analysesPending.delete(key));
      analysesPending.set(key, task);
    }
    return analysesPending.get(key);
  }
  function submit(actor, body, id = null) {
    actorId(actor);
    return queue(() => {
      const name = text(body.name, '姓名', 50), purpose = text(body.purpose, '报销事由', 500);
      const amount = amountCents(body.amount);
      const expenses = normalizeExpenses(body, amountCents);
      const expenseDate = body.expenseDate ? checkedDate(body.expenseDate, '费用发生日期') : '';
      const voucherNote = checkedText(body.voucherNote, '凭证说明', 1000, true);
      if (expenses.activityId) summaryService.validateActivity(expenses.activityId);
      const key = text(body.idempotencyKey, '操作标识', 160);
      const bundle = bundles.get(body.bundleId);
      if (!bundle || bundle.owner !== actor.id) fail(404, '请选择属于本账号的材料。');
      const fingerprint = JSON.stringify({ owner: actor.id, id, name, purpose, amount, bundleId: bundle.id, expenseDate, voucherNote, ...expenses });
      const receiptKey = `${actor.id}:${key}`, repeated = receipts.get(receiptKey);
      if (repeated) {
        if (repeated.fingerprint !== fingerprint) fail(409, '同一操作标识不能用于不同申请内容。');
        return { ok: true, duplicate: true, request: requestSummary(requests.get(repeated.id)) };
      }
      let item;
      if (id) {
        item = target(id, actor);
        if (item.status !== 'returned') fail(409, '只有待补充的申请可以重新提交。');
        if (item.bundleId === bundle.id) fail(400, '请重新整理并上传补充后的材料。');
      } else {
        if ([...requests.values()].some(item => item.bundleId === bundle.id)) fail(409, '这份材料已提交，请查看现有申请。');
        if (requests.size >= 100) fail(413, '本地申请数量已达上限，请重启演示服务。');
        item = { id: randomUUID(), code: `BX-${randomUUID().slice(0, 8).toUpperCase()}`, owner: actor.id, history: [], revision: 0, createdAt: now() };
      }
      Object.assign(item, { name, purpose, amountCents: amount, bundleId: bundle.id, expenseDate, voucherNote, ...expenses, status: 'pending', updatedAt: now(), revision: item.revision + 1 });
      item.history.push({ action: id ? 'resubmit' : 'submit', actor: actor.id, at: now(), bundleId: bundle.id, revision: item.revision });
      requests.set(item.id, item); receipts.set(receiptKey, { fingerprint, id: item.id });
      return { ok: true, request: requestSummary(item) };
    });
  }
  function review(actor, id, body) {
    reviewer(actor);
    return queue(() => {
      const item = target(id, actor, true);
      if (item.status !== 'pending' || item.revision !== body.revision) fail(409, '申请状态或材料版本已变化，请刷新后审核。');
      if (!['approve', 'return'].includes(body.action)) fail(400, '请选择通过或退回补充。');
      const note = body.action === 'return' ? text(body.note, '退回原因', 1000) : String(body.note || '').trim();
      if (note.length > 1000) fail(400, '审核意见不能超过 1000 个字符。');
      if (body.action === 'approve' && (body.titleCheck === 'exception-confirmed' || body.sealCheck === 'not-required-confirmed') && !note)
        fail(400, '例外情况须在审核意见中写明已核实的依据。');
      if (body.action === 'approve' && (body.materialsChecked !== true || !['match', 'exception-confirmed'].includes(body.titleCheck)
        || !['present', 'not-required-confirmed'].includes(body.sealCheck))) fail(400, '通过前须人工确认材料、购买方名称和印章核对结果。');
      item.status = body.action === 'approve' ? 'approved' : 'returned'; item.updatedAt = now();
      item.history.push({ action: body.action, actor: actor.id, at: now(), note, revision: item.revision,
        ...(body.action === 'approve' ? { titleCheck: body.titleCheck, sealCheck: body.sealCheck, materialsChecked: true } : {}) });
      return { ok: true, request: requestSummary(item) };
    });
  }
  function list(actor, reviewing = false) {
    actorId(actor); if (reviewing) reviewer(actor);
    return { ok: true, local: true, notice: REIMBURSEMENT_NOTICE, requests: [...requests.values()]
      .filter(item => reviewing || item.owner === actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(requestSummary) };
  }
  return { preprocess, attachment, analyze, submit, review, list, summaries: summaryService,
    get: (actor, id, reviewing = false) => ({ ok: true, request: requestSummary(target(id, actor, reviewing)) }) };
}
