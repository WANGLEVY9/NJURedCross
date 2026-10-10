import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TABLE, TASK_COLUMNS, TASK_CLAIM_TABLE, TASK_CLAIM_COLUMNS,
  TASK_STATUS, SKILL_TABLE, SKILL_COLUMNS, SKILL_STATUS, SKILL_LEVELS,
} from '../lib/attachment/store.js';
import {
  TASK_TYPES, TASK_TITLE_MAX, TASK_DESC_MAX, SKILL_DESC_MIN,
  taskRow, taskFromRow, taskPortalView,
  claimRow, claimFromRow,
  skillRow, skillFromRow, skillPortalView,
  sortWishlist, starLabel,
  validateTaskInput, validateSkillInput, validateSkillReview,
} from '../lib/attachment/tasks.js';

/* -------------------------------------------------------------------------- *
 * v3 S5：任务发布/申领 + 技能星级（第 8 项 / D3 / D6）
 * -------------------------------------------------------------------------- */

test('S5 表定义：任务/申领/技能三表列名完整', () => {
  assert.equal(TASK_TABLE, '任务表');
  assert.deepEqual(TASK_COLUMNS, ['任务ID', '标题', '说明', '类型', '星级要求', '发布人', '状态', '发布时间', '认领人', '认领时间']);
  assert.equal(TASK_CLAIM_TABLE, '任务申领表');
  assert.deepEqual(TASK_CLAIM_COLUMNS, ['申领ID', '任务ID', '申领人', '状态', '时间', '说明']);
  assert.equal(SKILL_TABLE, '成员技能表');
  assert.equal(SKILL_COLUMNS.length, 10);
});

test('S5 状态机：任务三态 + 技能三态', () => {
  assert.equal(TASK_STATUS.open, '待认领');
  assert.equal(TASK_STATUS.claimed, '已认领');
  assert.equal(TASK_STATUS.closed, '已关闭');
  assert.equal(SKILL_STATUS.pending, '待审核');
  assert.equal(SKILL_STATUS.approved, '已通过');
  assert.equal(SKILL_STATUS.rejected, '已驳回');
});

test('S5 技能星级档位：1-5 且含义齐全', () => {
  assert.equal(SKILL_LEVELS.length, 5);
  assert.deepEqual(SKILL_LEVELS.map((item) => item.level), [1, 2, 3, 4, 5]);
  for (const item of SKILL_LEVELS) {
    assert.ok(item.label && item.hint, `第 ${item.level} 星应有 label 与 hint`);
  }
  assert.equal(starLabel(3), '3 星 · 精通');
  assert.equal(starLabel(0), '0 星');
});

test('S5 任务行映射往返无损', () => {
  const source = {
    id: 'TSK-1', title: '拍摄秋季急救培训', description: '需要 2 名摄影',
    type: '摄影摄像', stars: 4, publisher: 'ACC-1', status: TASK_STATUS.open,
    publishedAt: '2026-10-10T10:00:00.000Z',
  };
  const round = taskFromRow(taskRow(source));
  assert.equal(round.id, 'TSK-1');
  assert.equal(round.title, '拍摄秋季急救培训');
  assert.equal(round.stars, 4);
  assert.equal(round.publisher, 'ACC-1');
  assert.equal(round.status, TASK_STATUS.open);
});

test('S5 任务门户视图不含内部 _id', () => {
  const view = taskPortalView({ id: 'TSK-1', title: 'x', stars: 3, _id: 'row-secret' });
  assert.equal('_id' in view, false, '门户视图不得含 SeaTable 行 id');
});

test('S5 星级必须是 1-5 整数，非法值归零', () => {
  assert.equal(taskFromRow({ 星级要求: 0 }).stars, 0);
  assert.equal(taskFromRow({ 星级要求: 6 }).stars, 0, '超出上限归零');
  assert.equal(taskFromRow({ 星级要求: 'abc' }).stars, 0);
  assert.equal(taskFromRow({ 星级要求: 5 }).stars, 5);
});

test('S5 心愿清单排序：待认领优先 → 星级降序 → 发布时间升序', () => {
  const tasks = [
    { id: 'A', status: TASK_STATUS.claimed, stars: 5, publishedAt: '2026-01-01' },
    { id: 'B', status: TASK_STATUS.open, stars: 3, publishedAt: '2026-01-02' },
    { id: 'C', status: TASK_STATUS.open, stars: 5, publishedAt: '2026-01-03' },
    { id: 'D', status: TASK_STATUS.open, stars: 5, publishedAt: '2026-01-01' },
  ];
  const sorted = sortWishlist(tasks).map((t) => t.id);
  assert.deepEqual(sorted, ['D', 'C', 'B', 'A'], '待认领高星且最早发布排最前，已认领垫底');
});

test('S5 发布任务校验：标题必填、星级必填、类型白名单', () => {
  assert.equal(validateTaskInput({}).ok, false);
  assert.equal(validateTaskInput({ title: 'x' }).errors.some((e) => e.code === 'task_stars_required'), true);
  const bad = validateTaskInput({ title: 'x', stars: 3, type: '不存在类型' });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.some((e) => e.code === 'task_type_invalid'), true);
  const good = validateTaskInput({ title: '拍摄活动', stars: 4, type: TASK_TYPES[0], description: '说明' });
  assert.equal(good.ok, true);
  assert.equal(good.value.stars, 4);
});

test('S5 发布任务校验：标题超长、说明超长被拦', () => {
  assert.equal(validateTaskInput({ title: 'x'.repeat(TASK_TITLE_MAX + 1), stars: 3 }).errors.some((e) => e.code === 'task_title_too_long'), true);
  assert.equal(validateTaskInput({ title: 'x', stars: 3, description: 'y'.repeat(TASK_DESC_MAX + 1) }).errors.some((e) => e.code === 'task_desc_too_long'), true);
});

test('S5 技能提交：说明必填且有最小长度（D3）', () => {
  assert.equal(validateSkillInput({ name: '摄影', selfStars: 3 }).errors.some((e) => e.code === 'skill_desc_required'), true);
  const short = validateSkillInput({ name: '摄影', selfStars: 3, description: '会' });
  assert.equal(short.errors.some((e) => e.code === 'skill_desc_too_short'), true);
  const good = validateSkillInput({ name: '摄影', selfStars: 3, description: '拍摄过 10 场校级活动并独立完成后期' });
  assert.equal(good.ok, true);
  assert.ok(SKILL_DESC_MIN >= 5, '最小长度不应过低');
});

test('S5 技能提交：名称必填、星级必填', () => {
  assert.equal(validateSkillInput({}).errors.some((e) => e.code === 'skill_name_required'), true);
  assert.equal(validateSkillInput({ name: '摄影', description: '拍摄过很多场活动' }).errors.some((e) => e.code === 'skill_stars_required'), true);
});

test('S5 技能审核校验：通过需给星级、驳回需写原因', () => {
  assert.equal(validateSkillReview({ decision: 'approve' }).errors.some((e) => e.code === 'skill_level_required'), true);
  assert.equal(validateSkillReview({ decision: 'reject' }).errors.some((e) => e.code === 'skill_note_required'), true);
  assert.equal(validateSkillReview({ decision: 'approve', level: 4 }).ok, true);
  assert.equal(validateSkillReview({ decision: 'reject', note: '材料不足' }).ok, true);
  assert.equal(validateSkillReview({ decision: 'maybe' }).errors.some((e) => e.code === 'skill_decision_invalid'), true);
});

test('S5 申领行映射往返', () => {
  const round = claimFromRow(claimRow({
    id: 'TSK-CLAIM-1', taskId: 'TSK-1', claimant: 'ACC-2',
    status: TASK_STATUS.claimed, at: '2026-10-10T12:00:00.000Z', note: '我可以',
  }));
  assert.equal(round.id, 'TSK-CLAIM-1');
  assert.equal(round.taskId, 'TSK-1');
  assert.equal(round.claimant, 'ACC-2');
  assert.equal(round.note, '我可以');
});

test('S5 技能行映射：审核人/意见/时间可回读', () => {
  const round = skillFromRow(skillRow({
    id: 'SKL-1', account: 'ACC-1', name: '摄影', description: '拍摄经验丰富',
    selfStars: 3, status: SKILL_STATUS.approved, reviewer: '管理员', reviewNote: '通过',
  }));
  assert.equal(round.status, SKILL_STATUS.approved);
  assert.equal(round.reviewer, '管理员');
  assert.equal(round.reviewNote, '通过');
  assert.equal(round.selfStars, 3);
});

test('S5 技能门户视图不泄露账号标识', () => {
  const view = skillPortalView({ id: 'SKL-1', name: '摄影', account: 'ACC-1', _id: 'row-1' });
  assert.equal('account' in view, false, '门户视图不得含账号引用');
  assert.equal('_id' in view, false);
});

test('S5 任务类型白名单非空且去重', () => {
  assert.ok(TASK_TYPES.length >= 4);
  assert.equal(new Set(TASK_TYPES).size, TASK_TYPES.length, '类型不应重复');
});
