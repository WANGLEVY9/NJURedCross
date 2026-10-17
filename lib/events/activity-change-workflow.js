import { activityChangeDigest } from './activity-change.js';
import { createActivityChangeService } from './activity-change-service.js';

const fields = ['活动名称', '报名日期', '报名时段', '容量', '服务时长', '培训时长', '交通时长', '地点', '工作内容', '通知草稿'];
const protectedAfterBooking = ['报名日期', '报名时段', '服务时长', '培训时长', '交通时长'];
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const configOf = event => JSON.parse(event['报名页配置'] || '{}');

/** Adapter for authoritative workflow reads, validation, signing and mutation queue. */
export function createActivityChangeWorkflow({ store, transaction, loadRows, tables,
  prepare, assertPrepared, approvalHash, isApproved, approvalRouting, updateEvent }) {
  async function loadEvent(id) {
    const matches = (await loadRows(tables.events)).filter(event => event._id === id || event['活动ID'] === id);
    if (matches.length !== 1) throw fail(matches.length ? 409 : 404, '活动不存在或出现重复，请核对');
    return matches[0];
  }
  async function reviewer(event, actor) {
    if (!approvalRouting) throw fail(503, '变更审核需要启用审核人权限校验');
    return approvalRouting.assertReviewer(event, actor);
  }
  function isOwner(event, actor) {
    return event['负责人账号ID'] === actor || (configOf(event).coOwners || []).includes(actor);
  }
  async function assertCanRead(event, actor) {
    if (!actor) throw fail(403, '请先登录');
    if (!isOwner(event, actor)) await reviewer(event, actor);
  }
  function assertSupported(event) {
    const config = configOf(event);
    if (config.source?.kind === 'generated_blood' || config.blood || config.ordinary || config.positionPlan || config.parentActivityId || config.bookingMode === 'grouped') throw fail(409, '此活动由项目岗位或排班流程维护，暂不支持独立变更');
    if (event['状态'] !== '报名中' || !isApproved(event)) throw fail(409, '仅批准信息有效的报名中活动可提交变更');
  }
  function candidate(event, patch) {
    assertSupported(event);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !fields.includes(key))) throw fail(400, '变更包含不允许修改的字段');
    if (Object.values(patch).some(value => !['number', 'string'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value))) throw fail(400, '变更字段值无效');
    const old = configOf(event), row = { ...event, ...patch };
    const body = { ...old, name: row['活动名称'], date: row['报名日期'], slot: row['报名时段'], capacity: row['容量'],
      serviceHours: row['服务时长'], trainingHours: row['培训时长'], travelHours: row['交通时长'], location: row['地点'], work: row['工作内容'], category: event['活动类别'] };
    if (String(row['报名时段']) !== String(event['报名时段'])) {
      if (old.window) {
        const pieces = String(row['报名时段']).split(' — ');
        if (pieces.length !== 2 || pieces.some(value => !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))) throw fail(400, '活动起止时间格式无效');
        body.window = { start: pieces[0].replace(' ', 'T') + '+08:00', end: pieces[1].replace(' ', 'T') + '+08:00' };
      } else if (old.startTime || old.endTime) {
        const match = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(String(row['报名时段']));
        if (!match) throw fail(400, '请选择有效的活动时段');
        [, body.startTime, body.endTime] = match;
      }
    }
    if (old.window && String(row['报名日期']) !== String(body.window.start).slice(0, 10)) throw fail(400, '日期与活动开始时间不一致');
    const prepared = prepare(body), config = { ...old, ...configOf(prepared) };
    const notice = Object.hasOwn(patch, '通知草稿') ? String(patch['通知草稿']).trim() : old.noticeCustomized ? event['通知草稿'] : prepared['通知草稿'];
    if (!notice || notice.length > 5000) throw fail(400, '通知不能为空或超过5000字');
    if (Object.hasOwn(patch, '通知草稿')) config.noticeCustomized = true;
    const result = { ...event, ...Object.fromEntries(Object.entries(prepared).map(([key, value]) => [key, String(value ?? '')])),
      通知草稿: notice, 报名页配置: JSON.stringify(config) };
    assertPrepared(result);
    return result;
  }
  async function validatePatch(event, patch) {
    const next = candidate(event, patch);
    const [registrations, checkins, ledger] = await Promise.all([tables.registrations, tables.checkins, tables.ledger].map(loadRows));
    const own = rows => rows.filter(row => row['活动ID'] === event['活动ID']);
    if (own(checkins).length || own(ledger).length) throw fail(409, '已有签到或时长记录，不能改写活动批准版本');
    const bookings = own(registrations);
    if (bookings.length && protectedAfterBooking.some(field => String(next[field]) !== String(event[field]))) throw fail(409, '已有报名记录，不能变更日期、时段或时长规则');
    const occupied = bookings.filter(row => ['待筛选', '已确认', '已签到'].includes(row['报名状态'])).length;
    if (Number(next['容量']) < occupied) throw fail(409, '新容量不能少于当前占位报名人数');
    return Object.fromEntries(fields.filter(field => String(next[field] ?? '') !== String(event[field] ?? '')).map(field => [field, next[field]]));
  }
  return createActivityChangeService({ store, transaction, loadEvent, assertCanRead,
    async assertCanSubmit(event, actor) {
      assertSupported(event);
      if (!isOwner(event, actor)) {
        const account = await reviewer(event, actor);
        if (account.role !== 'super_admin' && !account.canSelfReview) throw fail(403, '仅负责人或全局管理员可提交此活动变更');
      }
    },
    async assertCanReview(event, proposal, actor) {
      const account = await reviewer(event, actor), global = account.role === 'super_admin' || account.canSelfReview;
      if (!global && (event['负责人账号ID'] === actor || configOf(event).lastEditor === actor)) throw fail(403, '负责人或原修改人不能审核此活动变更');
      return { canReview: true, allowSelfReview: Boolean(global) };
    },
    validatePatch,
    async applyChange(event, patch, receipt) {
      const latest = await loadEvent(event['活动ID']);
      if (activityChangeDigest(latest) !== activityChangeDigest(event)) throw fail(409, '正式活动已变化，请重新核对');
      const next = candidate(latest, await validatePatch(latest, patch));
      const config = configOf(next);
      config.lastEditor = store.get(receipt.requestId).proposal.actor;
      config.appliedActivityChange = { ...receipt, appliedAt: new Date().toISOString() };
      const version = String(Number(event['申请版本']) + 1);
      const changes = { ...Object.fromEntries(fields.map(field => [field, next[field]])), 报名页配置: JSON.stringify(config),
        申请版本: version, 批准版本: version, 审批人: receipt.actor, 审批时间: new Date().toISOString() };
      changes['批准摘要'] = approvalHash({ ...latest, ...changes });
      await updateEvent(latest, changes);
    },
    wasApplied(event, proposal) {
      const receipt = configOf(event).appliedActivityChange;
      return isApproved(event) && receipt?.requestId === proposal.id && receipt?.baseDigest === proposal.baseDigest;
    },
  });
}
