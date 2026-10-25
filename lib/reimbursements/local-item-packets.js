import { processItemPackets } from './processor.js';
import { materialFilename } from '../../public/app/shared/reimbursement-files.js';
import { reimbursementMaterialGroups, isOrderPayment } from '../../public/app/shared/reimbursement-groups.js';

function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }

/** Reviewer-only, explicit, version-bound derivatives. No workflow or payment transition. */
export function createLocalItemPackets({ queue, target, bundles, bundleSummary, reserveBytes, now, workflowVersion = 1, authorizeGenerate = () => {}, generate = processItemPackets }) {
  const sets = new Map();
  const keyFor = item => `${item.id}:${item.revision}:${item.bundleId}`;
  function publicSet(set) {
    return structuredClone({ requestId: set.requestId, revision: set.revision, bundleId: set.bundleId,
      createdAt: set.createdAt, checkedBy: set.checkedBy, groups: set.groups.map(({ files: _files, ...group }) => group) });
  }
  function list(actor, id) {
    const item = target(id, actor, true), set = sets.get(keyFor(item));
    return { ok: true, local: true, packets: set ? publicSet(set) : null };
  }
  function create(actor, id, body) {
    target(id, actor, true);
    authorizeGenerate(actor);
    return queue(async () => {
      const item = target(id, actor, true);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some(key => !['revision', 'bundleId', 'materialsChecked'].includes(key))) fail(400, '材料生成请求不正确。');
      if (item.revision !== body.revision || item.bundleId !== body.bundleId) fail(409, '申请材料版本已变化，请刷新后重新核对。');
      if (!(workflowVersion === 2 ? ['pending', 'initial_returned'] : ['pending', 'approved']).includes(item.status)) fail(409, '该申请不处于材料整理环节，请刷新后核对。');
      if (body.materialsChecked !== true) fail(400, '请先逐份核对原材料与申请金额，并勾选确认。');
      const existing = sets.get(keyFor(item));
      if (existing) return { ok: true, local: true, duplicate: true, packets: publicSet(existing) };
      if (sets.size >= 30) fail(413, '本轮按项目材料包已达容量上限。');
      const bundle = bundles.get(item.bundleId);
      const groups = reimbursementMaterialGroups({ ...item, bundle: bundleSummary(bundle) }).filter(group => group.files.length);
      if (!groups.length || groups.some(group => group.kind === 'unassigned')) fail(400, '部分材料缺少可靠的支出项目或类型关联，请退回补充，不能按文件名猜测。');
      const result = await generate({ merged: bundle.merged, sources: bundle.sources, groups: groups.map(group => ({
        indices: group.files.map(file => file.index), orderPaymentIndices: group.files.filter(isOrderPayment).map(file => file.index),
      })) });
      if (!Array.isArray(result) || result.length !== groups.length) fail(400, '材料生成结果不完整，请重试。');
      const generated = groups.map((group, index) => {
        const root = `/api/preview/reimbursements/requests/${item.id}/material-packets/${item.revision}/${index}`;
        const fileFor = (kind, type) => {
          const file = result[index][kind];
          if (!file || !Buffer.isBuffer(file.bytes) || !Number.isSafeInteger(file.pageCount) || file.pageCount < 0 || file.pageCount > 100
            || Boolean(file.bytes.length) !== Boolean(file.pageCount) || !Array.isArray(file.sources)) fail(400, '材料生成结果不完整，请重试。');
          const name = materialFilename({ name: item.name, label: group.label, kind: 'supporting', index,
            amount: (group.amountCents / 100).toFixed(2), materialType: type });
          return { ...file, name, url: file.pageCount ? `${root}/${kind}` : null };
        };
        const merged = fileFor('merged', '合并材料'), orderPayment = fileFor('orderPayment', '订单及付款材料');
        const originalOnly = group.files.filter(file => !bundle.sources[file.index].pages).map(file => ({
          index: file.index, name: file.name, url: file.url, sha256: bundle.sources[file.index].sha256,
        }));
        const { files: _files, ...metadata } = group;
        return { ...metadata, originalOnly, merged: { name: merged.name, url: merged.url, pageCount: merged.pageCount, sources: merged.sources },
          orderPayment: { name: orderPayment.name, url: orderPayment.url, pageCount: orderPayment.pageCount, sources: orderPayment.sources },
          files: { merged, orderPayment } };
      });
      reserveBytes(generated.reduce((sum, group) => sum + group.files.merged.bytes.length + group.files.orderPayment.bytes.length, 0));
      const set = { requestId: item.id, revision: item.revision, bundleId: item.bundleId, createdAt: now(), checkedBy: actor.id, groups: generated };
      sets.set(keyFor(item), set);
      return { ok: true, local: true, packets: publicSet(set) };
    });
  }
  function download(actor, id, revision, groupIndex, kind) {
    const item = target(id, actor, true);
    if (item.revision !== revision) fail(409, '申请材料版本已变化，请打开当前版本。');
    const set = sets.get(keyFor(item)), file = set?.groups[groupIndex]?.files[kind];
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 0 || !['merged', 'orderPayment'].includes(kind) || !file?.bytes.length) fail(404, '按项目合并材料不存在。');
    return { name: file.name, bytes: Buffer.from(file.bytes), contentType: 'application/pdf' };
  }
  // Private input for activity summaries: consume the reviewed derivatives, never regenerate originals here.
  function summaryMaterials(actor, id) {
    const item = target(id, actor, true), set = sets.get(keyFor(item)), bundle = bundles.get(item.bundleId);
    if (!set || !bundle) fail(409, '缺少本版按项目合并材料，请交初审核查，不能使用旧材料替代。');
    const projected = bundleSummary(bundle);
    return set.groups.map((group, groupIndex) => ({ requestId: item.id, revision: item.revision, bundleId: item.bundleId,
      groupIndex, groupKind: group.kind, expenseItemId: group.expenseItemId, label: group.label,
      checkedBy: set.checkedBy, bytes: Buffer.from(group.files.merged.bytes), pageCount: group.merged.pageCount,
      sources: [...group.merged.sources.map(source => {
        const original = bundle.sources[source.index];
        if (!original || original.sha256 !== source.sha256) fail(409, '材料来源已变化，请重新核查。');
        return { name: projected.sources[source.index].name, originalName: original.originalName,
          sha256: source.sha256, originalIndex: source.index, originalStartPage: 1, originalEndPage: original.pages,
          startPage: source.startPage, endPage: source.endPage };
      }), ...group.originalOnly.map(source => ({ name: projected.sources[source.index].name, sha256: source.sha256, originalIndex: source.index,
        startPage: null, endPage: null }))] }));
  }
  return { list, create, download, summaryMaterials };
}
