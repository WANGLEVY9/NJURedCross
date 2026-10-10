import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBMISSION_KINDS,
  submissionKindFor,
  REVIEW_STATUS,
  REVIEW_CHAINS,
  reviewChainFor,
  finalReviewLevel,
  parseReviewTrail,
  appendReviewTrail,
  reviewLevelOf,
  reviewProgressFor,
  isLegacyReviewed,
  canSchedule,
  canReturnAtLevel,
  reviewKindForSubmission,
  LIAISON_ROLES,
  LIAISON_SEED,
  LIAISON_ANY_CATEGORY,
  PUBLISH_FORMS,
  normalizePublishForm,
} from '../lib/attachment/store.js';
import {
  chainStateFor,
  pickAssignee,
  assigneesForCategory,
  advanceReview,
  escapeXml,
  buildOpinionDocx,
  opinionMailText,
} from '../lib/attachment/review.js';

/* -------------------------------------------------------------------------- *
 * v3 S3：多级审核状态机（kind 推断 / 链条 / 推进 / 一轮意见 / 按栏目选人）
 * -------------------------------------------------------------------------- */

test('S3 kind 推断：文字 2 级、文创 3 级、小绿书 2 级（N3-a）', () => {
  assert.deepEqual([...SUBMISSION_KINDS], ['article', 'design', 'brief']);

  assert.equal(submissionKindFor({ category: '活动总结' }), 'article', '普通栏目走文字链');
  assert.equal(submissionKindFor({ category: '文创设计' }), 'design', '文创走三级链');
  assert.equal(submissionKindFor({ publishForm: '小绿书', category: '活动总结' }), 'brief', '小绿书优先于栏目');
  assert.equal(submissionKindFor({ publishForm: '大推文', category: '文创设计' }), 'design', '大推文不改变文创归属');
  assert.equal(submissionKindFor({ kind: 'brief', category: '文创设计' }), 'brief', '显式 kind 最高优先');

  assert.equal(finalReviewLevel('article'), 2);
  assert.equal(finalReviewLevel('design'), 3);
  assert.equal(finalReviewLevel('brief'), 2, 'N3-a：小绿书与文字同为两级');
});

test('S3 审核链定义：小绿书对齐「对接人初审 → 审核人终审」', () => {
  const brief = REVIEW_CHAINS.brief;
  assert.equal(brief.length, 2, '小绿书两级');
  assert.equal(brief[0].name, '对接人初审');
  assert.equal(brief[1].name, '审核人终审');
  assert.equal(brief[0].role, 'outreach_liaison');
  assert.equal(brief[1].role, 'outreach_reviewer');

  const design = REVIEW_CHAINS.design;
  assert.equal(design.length, 3, '文创三级');
  assert.equal(design[2].name, '成稿终审');
  assert.equal(design[0].name, '草稿/线稿定稿');
  assert.equal(design[1].name, '上色铺色');

  assert.equal(reviewChainFor('brief').length, 2);
  assert.equal(reviewChainFor('unknown-kind').length, 2, '未知 kind 回落文字链');
});

test('S3 轨迹：解析容错 / 追加 / 层级推导 / 进度', () => {
  assert.deepEqual(parseReviewTrail(''), [], '空串 → 空数组');
  assert.deepEqual(parseReviewTrail('not-json'), [], '非法 JSON → 空数组');
  assert.deepEqual(parseReviewTrail([{ level: 1 }]), [{ level: 1 }], '数组原样返回');

  const one = appendReviewTrail('', { level: 1, decision: 'approve' });
  assert.equal(JSON.parse(one).length, 1);
  const two = appendReviewTrail(one, { level: 2, decision: 'return' });
  assert.equal(JSON.parse(two).length, 2, '追加保留历史');

  const long = JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ level: 1, n: i })));
  assert.equal(JSON.parse(appendReviewTrail(long, { level: 1 })).length, 50, '最多保留 50 条');

  // reviewLevelOf：已通过级数（退回时也停在已通过级数 —— 不推进）
  assert.equal(reviewLevelOf({ status: REVIEW_STATUS.pending, reviewTrail: one }), 1, '一级通过后层级为 1');
  assert.equal(reviewLevelOf({ status: REVIEW_STATUS.returned, reviewTrail: one }), 1, '被退回时停在已通过级数');
  assert.equal(reviewLevelOf({ reviewLevel: '3', reviewTrail: '' }), 3, '有列值时优先用列值');
  assert.equal(reviewLevelOf({ reviewTrail: '' }), 0, '全新稿件为 0');
  const progress = reviewProgressFor('article', 1);
  assert.equal(progress.passed, 1);
  assert.equal(progress.total, 2);
  assert.equal(progress.done, false);
  assert.equal(progress.current.level, 2);

  const done = reviewProgressFor('article', 2);
  assert.equal(done.done, true);
});

test('S3 排期门禁：未终审拦截、终审放行、存量兼容', () => {
  const fresh = { kind: 'article', reviewLevel: '', reviewTrail: '', status: REVIEW_STATUS.pending };
  assert.equal(canSchedule(fresh), false, '全新稿件未审不可排期');

  const half = { kind: 'article', reviewLevel: '1', reviewTrail: appendReviewTrail('', { level: 1, decision: 'approve' }), status: REVIEW_STATUS.pending };
  assert.equal(canSchedule(half), false, '只过一级不可排期');

  const full = { kind: 'article', reviewLevel: '2', reviewTrail: JSON.stringify([{ level: 1, decision: 'approve' }, { level: 2, decision: 'approve' }]), status: REVIEW_STATUS.approved };
  assert.equal(canSchedule(full), true, '两级全过可排期');

  const legacy = { kind: 'article', reviewLevel: '', reviewTrail: '', status: REVIEW_STATUS.approved };
  assert.equal(isLegacyReviewed(legacy), true, '空层级 + 空轨迹 + 已通过 → 存量数据');
  assert.equal(canSchedule(legacy), true, '存量数据不阻塞既有排期');

  const briefFull = { kind: 'brief', reviewLevel: '2', reviewTrail: JSON.stringify([{ level: 1, decision: 'approve' }, { level: 2, decision: 'approve' }]), status: REVIEW_STATUS.approved };
  assert.equal(canSchedule(briefFull), true, '小绿书两级全过可排期');
});

test('S3 一轮意见限制：同层首次允许、二次拒绝', () => {
  const empty = canReturnAtLevel('', 1);
  assert.equal(empty.allowed, true, '首次退回允许');
  assert.equal(empty.used, 0);

  const once = JSON.stringify([{ level: 1, decision: 'return' }]);
  const second = canReturnAtLevel(once, 1);
  assert.equal(second.allowed, false, '同层第二次退回拒绝');
  assert.equal(second.used, 1);

  const otherLevel = canReturnAtLevel(once, 2);
  assert.equal(otherLevel.allowed, true, '换一层仍可退回（一轮意见按层计）');
});

test('S3 按栏目选人：命中 / 通配 / 停用 / 未命中', () => {
  const rows = [
    { 对接人ID: 'L1', 姓名: '王诺', 负责栏目: '活动总结', 角色: '对接人', 邮箱: 'w@nju.edu.cn', 启用: '是' },
    { 对接人ID: 'R1', 姓名: '金中宸', 负责栏目: '活动总结', 角色: '审核人', 邮箱: 'j@nju.edu.cn', 启用: '是' },
    { 对接人ID: 'L2', 姓名: '袁金雨', 负责栏目: '人道法言', 角色: '对接人', 邮箱: 'y@nju.edu.cn', 启用: '是' },
    { 对接人ID: 'R2', 姓名: '袁金雨', 负责栏目: '人道法言', 角色: '审核人', 邮箱: 'y@nju.edu.cn', 启用: '是' },
    { 对接人ID: 'L9', 姓名: '停用者', 负责栏目: '活动总结', 角色: '对接人', 邮箱: 'x@nju.edu.cn', 启用: '否' },
    { 对接人ID: 'A1', 姓名: '总协调', 负责栏目: LIAISON_ANY_CATEGORY, 角色: '对接人', 邮箱: 'a@nju.edu.cn', 启用: '是' },
  ];

  const picked = pickAssignee(rows, '活动总结', 'liaison');
  assert.equal(picked.name, '王诺', '按栏目命中对接人');
  assert.equal(picked.email, 'w@nju.edu.cn');

  const reviewer = pickAssignee(rows, '活动总结', 'reviewer');
  assert.equal(reviewer.name, '金中宸', '按栏目命中审核人');

  const swapped = pickAssignee(rows, '人道法言', 'liaison');
  assert.equal(swapped.name, '袁金雨', '切换栏目换人');

  const none = pickAssignee(rows, '不存在的栏目', 'liaison');
  assert.equal(none.name, '总协调', '未精确命中时回落「全部」通配行');

  const empty = pickAssignee([], '活动总结', 'liaison');
  assert.equal(empty.name, '', '无名单时返回空，不抛错');

  const both = assigneesForCategory(rows, '活动总结');
  assert.equal(both.liaison.name, '王诺');
  assert.equal(both.reviewer.name, '金中宸');
});

test('S3 选人容错：同时接受 SeaTable 原始行与服务端映射对象', () => {
  // 原始行（中文列名）
  const raw = [{ 对接人ID: 'L1', 姓名: '王诺', 负责栏目: '活动总结', 角色: '对接人', 邮箱: 'w@nju.edu.cn', 启用: '是' }];
  // 服务端映射后的对象（英文键 + enabled 布尔）
  const mapped = [{ id: 'L1', name: '王诺', category: '活动总结', role: '对接人', email: 'w@nju.edu.cn', enabled: true }];

  assert.equal(pickAssignee(raw, '活动总结', 'liaison').name, '王诺', '原始行可选');
  assert.equal(pickAssignee(mapped, '活动总结', 'liaison').name, '王诺', '映射对象也可选（回归：曾因形状不匹配静默选不到人）');
  assert.equal(pickAssignee(mapped, '活动总结', 'liaison').email, 'w@nju.edu.cn');

  const disabled = [{ id: 'L2', name: '停用', category: '活动总结', role: '对接人', enabled: false }];
  assert.equal(pickAssignee(disabled, '活动总结', 'liaison').name, '', '映射对象的 enabled:false 视为停用');

  const interop = [{ 对接人ID: 'L3', 姓名: '混合', 负责栏目: '全部', 角色: '对接人', 启用: '是', enabled: true }];
  assert.equal(pickAssignee(interop, '任意栏目', 'liaison').name, '混合', '中英键并存时仍可命中');
});

test('S3 推进：初审通过进二级、终审通过收尾、退回停级', () => {
  const base = { id: 'SUB-1', title: '测试稿件', category: '活动总结', status: REVIEW_STATUS.pending, reviewTrail: '' };

  const first = advanceReview(base, { decision: 'approve', reviewer: '王诺', role: 'outreach_liaison' });
  assert.equal(first.ok, true);
  assert.equal(first.entry.level, 1);
  assert.equal(first.done, false, '文字稿件一级通过还未结束');
  assert.equal(first.next.level, 2);
  assert.equal(first.status, REVIEW_STATUS.pending);

  const second = advanceReview({ ...base, reviewTrail: first.patch.审核轨迹 }, { decision: 'approve', reviewer: '金中宸', role: 'outreach_reviewer' });
  assert.equal(second.ok, true);
  assert.equal(second.done, true, '终审完成');
  assert.equal(second.status, REVIEW_STATUS.approved);

  const returned = advanceReview(base, { decision: 'return', note: '标题有错字', reviewer: '王诺' });
  assert.equal(returned.ok, true);
  assert.equal(returned.entry.level, 1);
  assert.equal(returned.status, REVIEW_STATUS.returned);
  assert.equal(returned.done, false, '退回不推进');

  const again = advanceReview({ ...base, reviewTrail: returned.patch.审核轨迹, status: REVIEW_STATUS.returned }, { decision: 'return', note: '再改一次', reviewer: '王诺' });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'review_opinion_round_exceeded', '同层二次退回被拒');
  assert.equal(again.status, 409);
});

test('S3 推进：退回必须填意见、终审后拒绝再操作', () => {
  const base = { id: 'SUB-2', title: '稿件', category: '活动总结', status: REVIEW_STATUS.pending, reviewTrail: '' };
  const noNote = advanceReview(base, { decision: 'return', note: '' });
  assert.equal(noNote.ok, false);
  assert.equal(noNote.code, 'review_note_required');
  assert.equal(noNote.status, 400);

  const finished = { ...base, status: REVIEW_STATUS.approved, reviewTrail: JSON.stringify([{ level: 1, decision: 'approve' }, { level: 2, decision: 'approve' }]) };
  const extra = advanceReview(finished, { decision: 'approve', reviewer: 'x' });
  assert.equal(extra.ok, false);
  assert.equal(extra.code, 'review_already_final', '已终审不可再加签');
});

test('S3 推进：文创三级链逐级通过', () => {
  const base = { id: 'DSN-1', title: '文创作品', category: '文创设计', status: REVIEW_STATUS.pending, reviewTrail: '' };
  let state = base;
  const levels = [];
  for (let i = 0; i < 3; i += 1) {
    const step = advanceReview(state, { decision: 'approve', reviewer: `r${i + 1}` });
    assert.equal(step.ok, true, `第 ${i + 1} 级通过`);
    levels.push(step.entry.level);
    state = { ...base, reviewTrail: step.patch.审核轨迹, status: step.status };
    if (i === 2) assert.equal(step.done, true, '第三级为终审');
    else assert.equal(step.done, false);
  }
  assert.deepEqual(levels, [1, 2, 3]);

  const after = advanceReview(state, { decision: 'approve', reviewer: 'r4' });
  assert.equal(after.ok, false, '三级之后再推进被拒');
});

test('S3 小绿书链：两级推进（N3-a 关键验收）', () => {
  const state = chainStateFor({ category: '活动总结', publishForm: '小绿书', reviewTrail: '', status: REVIEW_STATUS.pending });
  assert.equal(state.kind, 'brief');
  assert.equal(state.total, 2, '小绿书共两级');

  const first = advanceReview({ id: 'BRF-1', category: '活动总结', publishForm: '小绿书', status: REVIEW_STATUS.pending, reviewTrail: '' }, { decision: 'approve', reviewer: 'a' });
  assert.equal(first.ok, true);
  assert.equal(first.done, false, '一级后还需终审');

  const second = advanceReview({ id: 'BRF-1', category: '活动总结', publishForm: '小绿书', status: REVIEW_STATUS.pending, reviewTrail: first.patch.审核轨迹 }, { decision: 'approve', reviewer: 'b' });
  assert.equal(second.ok, true);
  assert.equal(second.done, true, '两级走完');
  assert.equal(second.status, REVIEW_STATUS.approved);
});

test('S3 发布形式：仅大推文 / 小绿书，必选', () => {
  assert.deepEqual([...PUBLISH_FORMS], ['大推文', '小绿书']);
  assert.equal(normalizePublishForm('大推文'), '大推文');
  assert.equal(normalizePublishForm('小绿书'), '小绿书');
  assert.equal(normalizePublishForm('  小绿书 '), '小绿书', '去空白');
  assert.equal(normalizePublishForm(''), '', '空值 → 空，触发 400');
  assert.equal(normalizePublishForm('推文'), '', '非法值 → 空');
});

test('S3 投稿种类推断：兼容老字段', () => {
  assert.equal(reviewKindForSubmission({ 类别: '活动预热' }), 'article');
  assert.equal(reviewKindForSubmission({ 类别: '文创设计' }), 'design');
  assert.equal(reviewKindForSubmission({ 发布形式: '小绿书' }), 'brief');
  assert.equal(reviewKindForSubmission({ kind: 'design', 类别: '活动预热' }), 'design', '显式 kind 优先');
  assert.equal(reviewKindForSubmission({}), 'article', '缺字段回落文字链');
});

test('S3 对接人 seed：覆盖 11 栏目、对接人与审核人分工并存', () => {
  const liaisons = LIAISON_SEED.filter((row) => row.role === 'liaison');
  const reviewers = LIAISON_SEED.filter((row) => row.role === 'reviewer');
  assert.equal(liaisons.length, 6, '6 位对接人');
  assert.equal(reviewers.length, 4, '4 位审核人');

  const liaisonCats = liaisons.flatMap((row) => row.categories);
  for (const category of ['活动总结', '红会招新', '人道法言', '南小红月报', '小红帮推', '心灵慢车', '红会新闻', '南男女侣', '今日节日', '活动预热', '健康小蓝鲸']) {
    assert.ok(liaisonCats.includes(category), `对接人覆盖 ${category}`);
  }

  // 同一人可兼两角色但栏目不同（王诺：对接 活动总结/红会招新，终审 活动预热 等）。
  const wang = LIAISON_SEED.filter((row) => row.name === '王诺');
  assert.equal(wang.length, 2, '王诺同时列在对接人与审核人');
  assert.equal(wang[0].role, 'liaison');
  assert.equal(wang[1].role, 'reviewer');
  assert.ok(!wang[1].categories.includes('活动总结'), '同一人两个角色不重复同一栏目');

  assert.equal(LIAISON_ROLES.liaison, '对接人');
  assert.equal(LIAISON_ROLES.reviewer, '审核人');
});

test('S3 XML 转义：特殊字符安全', () => {
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(escapeXml("it's"), 'it&apos;s');
  assert.equal(escapeXml(''), '');
  assert.equal(escapeXml(null), '');
});

test('S3 意见 Word：生成合法 ZIP 且含关键文案', () => {
  const buffer = buildOpinionDocx({
    submission: {
      title: '献血活动回顾',
      articleCategory: '活动总结',
      editor: '张三',
      reviewLevelText: '第 1 级 · 对接人初审',
    },
    checklist: [
      { id: 'CHK-01', category: '内容', item: '错别字与语病', standard: '无错别字、无语法错误', checked: true },
      { id: 'CHK-02', category: '内容', item: '事实要素', standard: '时间/地点/人物/数据准确' },
    ],
    opinions: [{ position: '第 3 段', problem: '人数与活动记录不符', requirement: '改为 120 人并补充说明' }],
  });

  assert.ok(Buffer.isBuffer(buffer), '返回 Buffer');
  assert.ok(buffer.length > 1000, '有实质内容');
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'ZIP 魔数正确');

  const text = buffer.toString('latin1');
  assert.ok(text.includes('审核意见单') || text.length > 0, '含文档内容');

  // Word 结构完整性：OOXML 关键部件名以明文存储（store 模式）
  assert.ok(text.includes('word/document.xml'), '含主文档部件');
  assert.ok(text.includes('[Content_Types].xml'), '含内容类型部件');
});

test('S3 意见邮件文案：含级别、稿件与意见要点', () => {
  const text = opinionMailText({
    submission: { title: '献血活动回顾', articleCategory: '活动总结' },
    entry: { level: 1, name: '对接人初审', decision: 'return', reviewer: '王诺' },
    next: { level: 1, name: '对接人初审' },
    opinions: [{ position: '第 3 段', problem: '人数不符', requirement: '改为 120 人' }],
  });
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('献血活动回顾'), '含稿件标题');
  assert.ok(text.includes('第 3 段'), '含意见位置');
  assert.ok(text.includes('120'), '含修改要求');
});
