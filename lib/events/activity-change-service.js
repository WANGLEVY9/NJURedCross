import { activityChangeDigest, proposeActivityChange, reviewActivityChange } from './activity-change.js';

const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** The workflow adapter must supply authoritative reads and its shared mutation queue.
 * applyChange must write an idempotency receipt together with the formal event patch.
 * wasApplied must verify that receipt AND the formal event's valid approval signature.
 */
export function createActivityChangeService(options) {
  const { store, transaction, loadEvent, assertCanRead, assertCanSubmit, assertCanReview,
    validatePatch, applyChange, wasApplied } = options;
  for (const [name, dependency] of Object.entries({ transaction, loadEvent, assertCanRead, assertCanSubmit, assertCanReview, validatePatch, applyChange, wasApplied })) {
    if (typeof dependency !== 'function') throw new Error(`缺少变更服务依赖：${name}`);
  }
  async function eventFor(id) {
    const event = await loadEvent(id);
    if (!event) throw fail(404, '活动不存在');
    return event;
  }
  async function entryFor(id, actor) {
    const entry = store.get(id);
    if (!entry) throw fail(404, '变更申请不存在');
    const event = await eventFor(entry.proposal.eventId);
    await assertCanRead(event, actor);
    return { entry, event };
  }
  function response(entry) {
    // No review token is returned to the UI.
    return structuredClone(entry);
  }
  async function present(entry, event, actor) {
    let canReview = false;
    try {
      const access = await assertCanReview(event, entry.proposal, actor);
      canReview = access?.canReview === true && (actor !== entry.proposal.actor || Boolean(access?.allowSelfReview));
    } catch (error) {
      if (![403, 409].includes(error.statusCode)) throw error;
    }
    return { ...response(entry), canReview };
  }
  return {
    async context(eventId, actor) {
      const event = await eventFor(eventId);
      await assertCanRead(event, actor);
      let canSubmit = false;
      try { await assertCanSubmit(event, actor); canSubmit = true; }
      catch (error) { if (![403, 409].includes(error.statusCode)) throw error; }
      return { event: structuredClone(event), expectedDigest: activityChangeDigest(event), canSubmit };
    },
    async get(id, actor, eventReference) {
      const { entry, event } = await entryFor(id, actor);
      if (eventReference !== undefined && (await eventFor(eventReference))['活动ID'] !== event['活动ID']) throw fail(404, '此活动没有对应的变更申请');
      return present(entry, event, actor);
    },
    async active(eventId, actor) {
      const event = await eventFor(eventId);
      await assertCanRead(event, actor);
      const entry = store.active(event['活动ID']);
      return entry ? present(entry, event, actor) : null;
    },
    preview(eventId, patch, { actor, expectedDigest }) {
      return transaction(async () => {
        const event = await eventFor(eventId);
        await assertCanSubmit(event, actor);
        if (expectedDigest !== activityChangeDigest(event)) throw fail(409, '活动信息已更新，请重新打开变更表单');
        const validated = await validatePatch(event, patch);
        const proposal = proposeActivityChange(event, validated, { actor, requestId: 'preview' });
        return { patch: validated, changes: proposal.changes };
      });
    },
    submit(eventId, patch, { actor, requestId, expectedDigest }) {
      return transaction(async () => {
        const event = await eventFor(eventId);
        await assertCanSubmit(event, actor);
        if (expectedDigest !== undefined && expectedDigest !== activityChangeDigest(event)) throw fail(409, '活动信息已更新，请重新打开变更表单');
        const validated = await validatePatch(event, patch);
        return response(store.create(proposeActivityChange(event, validated, { actor, requestId })));
      });
    },
    review(id, { actor, version, decision, reason = '' }) {
      return transaction(async () => {
        const { entry, event } = await entryFor(id, actor);
        const access = await assertCanReview(event, entry.proposal, actor);
        if (access?.canReview !== true) throw fail(403, '当前账号无权审核此变更');
        if (entry.proposal.actor === actor && !access?.allowSelfReview) throw fail(403, '不能审核自己提交的变更');
        if (!['approve', 'return'].includes(decision) || typeof reason !== 'string') throw fail(400, '审核决定或原因无效');
        if (entry.version !== version) throw fail(409, '变更申请已更新，请刷新');

        if (entry.status === 'applying') {
          if (entry.reviewer !== actor || entry.decision !== decision || entry.reason !== reason.trim()) throw fail(409, '变更正在处理，请核对原审核决定');
          const recovered = store.resumeReview(id, version, actor);
          if (decision === 'return') return response(store.finishReview(id, recovered.token, 'returned', reason));
          if (await wasApplied(event, entry.proposal)) return response(store.finishReview(id, recovered.token, 'approved', reason));
          throw fail(503, '上次应用结果尚未确认，禁止重复写入，请核对正式活动');
        }
        const plan = reviewActivityChange(event, { ...entry.proposal, status: entry.status }, {
          actor, canReview: true, allowSelfReview: Boolean(access?.allowSelfReview), decision, reason,
        });
        if (decision === 'approve') {
          const validated = await validatePatch(event, plan.patch);
          // The reviewer must approve exactly the submitted change, not a new
          // normalization silently introduced by changing defaults or policies.
          const actual = proposeActivityChange(event, validated, { actor: entry.proposal.actor, requestId: id });
          if (JSON.stringify(actual.changes) !== JSON.stringify(entry.proposal.changes)) throw fail(409, '变更规则已变化，请重新提交');
        }
        const started = store.beginReview(id, version, actor, { decision, reason });
        if (decision === 'return') return response(store.finishReview(id, started.token, 'returned', reason));

        // Any timeout or exception leaves the durable applying state intact.
        // Never clear it and blindly retry the external database update.
        await applyChange(event, plan.patch, { requestId: id, baseDigest: entry.proposal.baseDigest, actor });
        const current = await eventFor(event['活动ID']);
        if (!await wasApplied(current, entry.proposal)) throw fail(503, '活动变更结果待核实，请勿重复提交');
        return response(store.finishReview(id, started.token, 'approved', reason));
      });
    },
  };
}
