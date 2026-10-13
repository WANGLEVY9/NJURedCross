import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TABLE, TASK_COLUMNS, TASK_CLAIM_TABLE, TASK_CLAIM_COLUMNS,
  TASK_STATUS, CLAIM_STATUS, SKILL_TABLE, SKILL_COLUMNS, SKILL_STATUS, SKILL_LEVELS,
  SKILL_NAMES, SKILL_SOFTWARES, SKILL_OTHER, SKILL_PORTFOLIO_REQUIRED_FOR,
  formatSkillSoftwares, parseSkillSoftwares,
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
 * v3.1（2026-10-11）：技能名称改下拉 + 常用软件多选；任务发布附技能要求；
 *                     任务申领改为「管理员审核通过后才接到任务」。
 * -------------------------------------------------------------------------- */

test('S5 表定义：任务/申领/技能三表列名完整', () => {
  assert.equal(TASK_TABLE, '任务表');
  assert.deepEqual(TASK_COLUMNS, [
    '任务ID', '标题', '说明', '类型', '星级要求', '发布人', '状态', '发布时间', '认领人', '认领时间',
    '技能要求', '要求星级',
  ]);
  assert.equal(TASK_CLAIM_TABLE, '任务申领表');
  assert.deepEqual(TASK_CLAIM_COLUMNS, [
    '申领ID', '任务ID', '申领人', '状态', '时间', '说明',
    '审核人', '审核时间', '审核意见',
  ]);
  assert.equal(SKILL_TABLE, '成员技能表');
  assert.equal(SKILL_COLUMNS.length, 11);
  assert.ok(SKILL_COLUMNS.includes('常用软件'), '技能表需补「常用软件」列');
});

test('S5 状态机：任务四态（含申领审核中）+ 申领三态 + 技能三态', () => {
  assert.equal(TASK_STATUS.open, '待认领');
  assert.equal(TASK_STATUS.reviewing, '申领审核中');
  assert.equal(TASK_STATUS.claimed, '已认领');
  assert.equal(TASK_STATUS.closed, '已关闭');
  assert.equal(CLAIM_STATUS.pending, '待审核');
  assert.equal(CLAIM_STATUS.approved, '已通过');
  assert.equal(CLAIM_STATUS.rejected, '已驳回');
  assert.equal(SKILL_STATUS.pending, '待审核');
  assert.equal(SKILL_STATUS.approved, '已通过');
  assert.equal(SKILL_STATUS.rejected, '已驳回');
});

test('S5 技能字典：8 个技能名称 + 13 个常用软件 + 「其他」兜底', () => {
  assert.deepEqual([...SKILL_NAMES], [
    '图片处理', '公众号排版', '海报设计', '绘图与二创',
    '板写与 logo 设计', '动画与 live 2D', '3D建模', '其他',
  ]);
  assert.deepEqual([...SKILL_SOFTWARES], [
    'Procreate', '画世界 pro', '天生会画', 'PS', 'AI', 'Canva', '秀米',
    'Tinkercad', 'Blender', '3Dmax', 'AE', 'Live2D Cubism Editor', '其他',
  ]);
  assert.equal(SKILL_OTHER, '其他');
  assert.equal(SKILL_NAMES.at(-1), SKILL_OTHER, '技能名最后一档是「其他」');
  assert.equal(SKILL_SOFTWARES.at(-1), SKILL_OTHER, '软件最后一档是「其他」');
  assert.equal(SKILL_PORTFOLIO_REQUIRED_FOR, '绘图与二创');
  assert.equal(new Set(SKILL_NAMES).size, SKILL_NAMES.length, '技能名称不应重复');
  assert.equal(new Set(SKILL_SOFTWARES).size, SKILL_SOFTWARES.length, '软件名不应重复');
});

test('S5 常用软件列编解码：JSON 数组 ↔ 文本，含去重与历史兼容', () => {
  assert.equal(formatSkillSoftwares(['PS', 'AI', 'PS']), JSON.stringify(['PS', 'AI']));
  assert.equal(formatSkillSoftwares([]), '');
  assert.equal(formatSkillSoftwares(null), '');
  assert.deepEqual(parseSkillSoftwares('["PS","AI"]'), ['PS', 'AI']);
  assert.deepEqual(parseSkillSoftwares(''), []);
  assert.deepEqual(parseSkillSoftwares(undefined), []);
  // 非 JSON 历史值按顿号/逗号兜底切分。
  assert.deepEqual(parseSkillSoftwares('PS、AI、Canva'), ['PS', 'AI', 'Canva']);
  // 往返一致。
  assert.deepEqual(parseSkillSoftwares(formatSkillSoftwares(['Procreate', 'Blender'])), ['Procreate', 'Blender']);
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
    skillRequirement: '图片处理', skillStars: 3,
  };
  const round = taskFromRow(taskRow(source));
  assert.equal(round.id, 'TSK-1');
  assert.equal(round.title, '拍摄秋季急救培训');
  assert.equal(round.stars, 4);
  assert.equal(round.publisher, 'ACC-1');
  assert.equal(round.status, TASK_STATUS.open);
  // v3.1：技能要求（技能名称 + 所需星级）随任务往返。
  assert.equal(round.skillRequirement, '图片处理');
  assert.equal(round.skillStars, 3);
  assert.equal(taskPortalView(round).skillRequirement, '图片处理');
  assert.equal(taskPortalView(round).skillStars, 3);
});

test('S5 申领行映射往返 + 默认落「待审核」', () => {
  // 未显式给状态时默认「待审核」——申领不再直接生效，需管理员审核。
  assert.equal(claimRow({ id: 'TSK-C-0' })['状态'], CLAIM_STATUS.pending);
  const round = claimFromRow(claimRow({
    id: 'TSK-CLAIM-1', taskId: 'TSK-1', claimant: 'ACC-2',
    status: CLAIM_STATUS.approved, at: '2026-10-10T12:00:00.000Z', note: '我可以',
    reviewer: '管理员', reviewedAt: '2026-10-10T13:00:00.000Z', reviewNote: '通过',
  }));
  assert.equal(round.id, 'TSK-CLAIM-1');
  assert.equal(round.taskId, 'TSK-1');
  assert.equal(round.claimant, 'ACC-2');
  assert.equal(round.note, '我可以');
  assert.equal(round.status, CLAIM_STATUS.approved);
  assert.equal(round.reviewer, '管理员');
  assert.equal(round.reviewedAt, '2026-10-10T13:00:00.000Z');
  assert.equal(round.reviewNote, '通过');
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
  const good = validateTaskInput({
    title: '拍摄活动', stars: 4, type: TASK_TYPES[0], description: '说明',
    skillRequirement: '图片处理', skillStars: 3,
  });
  assert.equal(good.ok, true);
  assert.equal(good.value.stars, 4);
  assert.equal(good.value.skillRequirement, '图片处理');
  assert.equal(good.value.skillStars, 3);
});

test('S5 发布任务必须附带技能要求（技能名称 + 所需星级）', () => {
  const base = { title: '拍摄活动', stars: 4, type: TASK_TYPES[0] };
  const missingSkill = validateTaskInput(base);
  assert.equal(missingSkill.ok, false);
  assert.equal(missingSkill.errors.some((e) => e.code === 'task_skill_required'), true, '技能名称必填');
  assert.equal(missingSkill.errors.some((e) => e.code === 'task_skill_stars_required'), true, '所需星级必填');
  // 技能名称必须来自下拉字典。
  const invalid = validateTaskInput({ ...base, skillRequirement: '打螺丝', skillStars: 3 });
  assert.equal(invalid.errors.some((e) => e.code === 'task_skill_invalid'), true);
  // 选「其他」时以手填值为准。
  const other = validateTaskInput({ ...base, skillRequirement: '其他', skillStars: 2 });
  assert.equal(other.errors.some((e) => e.code === 'task_skill_required'), true, '选其他但未手填应拦下');
  const otherFilled = validateTaskInput({ ...base, skillRequirement: '其他', skillRequirementOther: '无人机航拍', skillStars: 2 });
  assert.equal(otherFilled.ok, true);
  assert.equal(otherFilled.value.skillRequirement, '无人机航拍');
  // 所需星级同样限定 1-5。
  assert.equal(validateTaskInput({ ...base, skillRequirement: '图片处理', skillStars: 6 }).errors.some((e) => e.code === 'task_skill_stars_required'), true);
});

test('S5 发布任务校验：标题超长、说明超长被拦', () => {
  const base = { stars: 3, skillRequirement: '图片处理', skillStars: 3 };
  assert.equal(validateTaskInput({ ...base, title: 'x'.repeat(TASK_TITLE_MAX + 1) }).errors.some((e) => e.code === 'task_title_too_long'), true);
  assert.equal(validateTaskInput({ ...base, title: 'x', description: 'y'.repeat(TASK_DESC_MAX + 1) }).errors.some((e) => e.code === 'task_desc_too_long'), true);
});

test('S5 技能提交：说明必填且有最小长度（D3）', () => {
  const base = { name: '图片处理', softwares: ['PS'], selfStars: 3 };
  assert.equal(validateSkillInput(base).errors.some((e) => e.code === 'skill_desc_required'), true);
  const short = validateSkillInput({ ...base, description: '会' });
  assert.equal(short.errors.some((e) => e.code === 'skill_desc_too_short'), true);
  const good = validateSkillInput({ ...base, description: '拍摄过 10 场校级活动并独立完成后期' });
  assert.equal(good.ok, true);
  assert.ok(SKILL_DESC_MIN >= 5, '最小长度不应过低');
});

test('S5 技能提交：名称必须来自下拉、选其他需手填', () => {
  const desc = '拍摄过 10 场校级活动并独立完成后期';
  assert.equal(validateSkillInput({ softwares: ['PS'] }).errors.some((e) => e.code === 'skill_name_required'), true);
  // 手填字典外的名称一律拒绝（v3.1 取消自由填写）。
  const invalid = validateSkillInput({ name: '摄影', softwares: ['PS'], selfStars: 3, description: desc });
  assert.equal(invalid.errors.some((e) => e.code === 'skill_name_invalid'), true);
  const otherEmpty = validateSkillInput({ name: SKILL_OTHER, softwares: ['PS'], selfStars: 3, description: desc });
  assert.equal(otherEmpty.errors.some((e) => e.code === 'skill_name_other_required'), true);
  const other = validateSkillInput({ name: SKILL_OTHER, nameOther: '无人机航拍', softwares: ['PS'], selfStars: 3, description: desc });
  assert.equal(other.ok, true);
  assert.equal(other.value.name, '无人机航拍');
});

test('S5 技能提交：常用软件多选至少 1 项、需星级、绘图与二创必交作品链接', () => {
  const desc = '拍摄过 10 场校级活动并独立完成后期';
  const base = { name: '图片处理', selfStars: 3, description: desc };
  assert.equal(validateSkillInput(base).errors.some((e) => e.code === 'skill_softwares_required'), true, '软件至少选 1 项');
  assert.equal(
    validateSkillInput({ name: '图片处理', softwares: ['PS'], description: desc }).errors.some((e) => e.code === 'skill_stars_required'),
    true,
    '星级必填',
  );
  // 软件去重 + 「其他」占位值需由前端并入实际值。
  const soft = validateSkillInput({ ...base, softwares: ['PS', 'PS', SKILL_OTHER, 'Procreate'], selfStars: 2 });
  assert.equal(soft.ok, true);
  assert.deepEqual(soft.value.softwares, ['PS', 'Procreate']);
  // 「绘图与二创」→ 往期作品链接必填。
  const portfolio = validateSkillInput({ name: SKILL_PORTFOLIO_REQUIRED_FOR, softwares: ['Procreate'], selfStars: 4, description: desc });
  assert.equal(portfolio.errors.some((e) => e.code === 'skill_portfolio_required'), true);
  const withProof = validateSkillInput({
    name: SKILL_PORTFOLIO_REQUIRED_FOR, softwares: ['Procreate'], selfStars: 4,
    description: desc, proof: 'https://example.com/portfolio',
  });
  assert.equal(withProof.ok, true);
  // 其他技能名不强制作品链接。
  assert.equal(validateSkillInput({ ...base, softwares: ['PS'] }).ok, true);
});

test('S5 技能审核校验：通过需给星级、驳回需写原因', () => {
  assert.equal(validateSkillReview({ decision: 'approve' }).errors.some((e) => e.code === 'skill_level_required'), true);
  assert.equal(validateSkillReview({ decision: 'reject' }).errors.some((e) => e.code === 'skill_note_required'), true);
  assert.equal(validateSkillReview({ decision: 'approve', level: 4 }).ok, true);
  assert.equal(validateSkillReview({ decision: 'reject', note: '材料不足' }).ok, true);
  assert.equal(validateSkillReview({ decision: 'maybe' }).errors.some((e) => e.code === 'skill_decision_invalid'), true);
});

test('S5 技能行映射：审核人/意见/时间/常用软件可回读', () => {
  const round = skillFromRow(skillRow({
    id: 'SKL-1', account: 'ACC-1', name: '图片处理', description: '拍摄经验丰富',
    selfStars: 3, status: SKILL_STATUS.approved, reviewer: '管理员', reviewNote: '通过',
    softwares: ['PS', 'AI', 'PS'],
  }));
  assert.equal(round.status, SKILL_STATUS.approved);
  assert.equal(round.reviewer, '管理员');
  assert.equal(round.reviewNote, '通过');
  assert.equal(round.selfStars, 3);
  assert.deepEqual(round.softwares, ['PS', 'AI'], '常用软件去重后往返一致');
  // 旧行无「常用软件」列时回落空数组。
  assert.deepEqual(skillFromRow({ 技能ID: 'SKL-OLD' }).softwares, []);
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
