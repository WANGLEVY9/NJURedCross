/**
 * 宣传「初审登记美编 → 终审写台账」链路（2026-11-24）。
 *
 * 背景：文字稿件第 1 级本来就叫「对接人初审（含美编招募）」，但系统从未记录招募结果，
 * 于是终审时「美编姓名/学号」无来源，「新媒体审核表」只能人工抄。这里锁死四条契约：
 *   1. 名册检索只返回 姓名/学号/院系/邮箱 四列，且是精确等值匹配（不可枚举通讯录）；
 *   2. 初审通过必须登记名册中的唯一一人，查不到/重名都拒；
 *   3. 终审通过必须填预期发布时间，否则不写库；
 *   4. 台账写入以「推文标题 + 文编学号」幂等，查重失败宁可拒写也不制造重复行。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBER_TABLE,
  findDirectoryMembers,
  memberLookupSql,
  normalizeMemberQuery,
} from '../lib/attachment/members.js';
import {
  buildTemplateRow,
  normalizePublishDate,
  syncTemplateRow,
} from '../lib/attachment/template-sync.js';
import { applyReviewStep } from '../lib/attachment/review-policy.js';
import { REVIEW_STATUS } from '../lib/attachment/store.js';

const ASSIGNEES = [
  { 对接人ID: 'L1', 姓名: '王诺', 负责栏目: '活动总结', 角色: '对接人', 邮箱: 'wang@example.invalid', 启用: '是' },
  { 对接人ID: 'R1', 姓名: '金中宸', 负责栏目: '活动总结', 角色: '审核人', 邮箱: 'jin@example.invalid', 启用: '是' },
];

const LIAISON = { username: 'wang', email: 'wang@example.invalid', realName: '王诺' };
const REVIEWER = { username: 'jin', email: 'jin@example.invalid', realName: '金中宸' };

const TANG = { name: '汤艺暄', studentId: '251880248', faculty: '智能科学与技术学院', email: '251880248@smail.nju.edu.cn' };

/** 文字稿件、两级链、尚未初审。 */
const PENDING_SHAPE = {
  id: 'SUB-1',
  title: '活动总结 | 青春有方，健康无虞',
  category: '文字稿件',
  articleCategory: '活动总结',
  publishForm: '大推文',
  reviewLevel: '',
  reviewTrail: '',
  status: REVIEW_STATUS.pending,
  contactName: '杨德丹',
  studentId: '241820262',
  submitterEmail: '241820262@smail.nju.edu.cn',
};

/** 已过初审（第 1 级通过，带美编快照），待终审。 */
const FINAL_SHAPE = {
  ...PENDING_SHAPE,
  reviewLevel: '1',
  reviewTrail: JSON.stringify([{
    level: 1, name: '对接人初审（含美编招募）', decision: 'approve',
    reviewer: 'wang', reviewerName: '王诺', at: '2026-11-24T10:00:00.000Z',
    manualEditor: TANG,
  }]),
  status: REVIEW_STATUS.pending,
};

function makeClient({ rows = [], insertResult = { _id: 'TPL-1' }, failQuery = false, failInsert = false } = {}) {
  const calls = { updates: [], inserts: [], queries: [] };
  return {
    calls,
    async updateRow(table, id, patch) { calls.updates.push({ table, id, patch }); },
    async insertRow(table, row) {
      if (failInsert) throw new Error('insert boom');
      calls.inserts.push({ table, row });
      return insertResult;
    },
    async query(sql) {
      calls.queries.push(sql);
      if (failQuery) throw new Error('query boom');
      return rows;
    },
  };
}

function stepContext(client, { shape = PENDING_SHAPE, account = LIAISON, members = [TANG], body = {} } = {}) {
  return {
    client,
    table: '宣传投稿表',
    contentId: shape.id,
    body: { decision: 'approve', checklist: [{ id: 'c1' }], ...body },
    account,
    reviewer: account.username,
    readRows: async () => [{ _id: 'ROW-1', 投稿ID: shape.id }],
    readAssignees: async () => ASSIGNEES,
    readChecklist: async () => [{ id: 'c1' }],
    readMember: async (query) => ({ query, members: members.filter(member => member.name === query || member.studentId === query), truncated: false }),
    shapeOf: () => shape,
  };
}

/* ------------------------------------------------------------------ 名册检索 */

test('检索词：只接受干净的姓名或学号', () => {
  assert.equal(normalizeMemberQuery('  汤艺暄 '), '汤艺暄');
  assert.equal(normalizeMemberQuery('251880248'), '251880248');
  assert.equal(normalizeMemberQuery(''), '', '空串无效');
  assert.equal(normalizeMemberQuery('  '), '', '纯空白无效');
  assert.equal(normalizeMemberQuery("汤'艺暄"), '', '单引号会破坏 SQL 字面量');
  assert.equal(normalizeMemberQuery('汤"艺暄'), '', '双引号同样拒绝');
  assert.equal(normalizeMemberQuery('汤\\艺暄'), '', '反斜杠拒绝');
  assert.equal(normalizeMemberQuery('汤\u0000艺暄'), '', '控制字符拒绝');
  assert.equal(normalizeMemberQuery('x'.repeat(33)), '', '超长拒绝');
});

test('检索 SQL：只取四列、精确等值、不 SELECT *', () => {
  const sql = memberLookupSql('汤艺暄');
  assert.match(sql, /SELECT `_id`, `姓名`, `学号`, `院系`, `邮箱`/, '列白名单固定');
  assert.doesNotMatch(sql, /SELECT \*/, '绝不整行读取名册（含身份证号/银行卡号）');
  assert.match(sql, /`姓名` = '汤艺暄' OR `学号` = '汤艺暄'/, '姓名与学号都是等值匹配');
  assert.doesNotMatch(sql, /LIKE/, '不做模糊匹配，避免被用来枚举通讯录');
  assert.match(sql, new RegExp(MEMBER_TABLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('名册检索：同学号两行收敛为一条，坏邮箱丢弃', async () => {
  const client = makeClient({
    rows: [
      { _id: 'A', 姓名: '邓清怡', 学号: '251250217', 院系: '商学院', 邮箱: '251250217@smail.nju.edu.cn' },
      { _id: 'B', 姓名: '邓清怡', 学号: '251250217', 院系: '商学院', 邮箱: '251250217@smail.nju.edu.cn' },
      { _id: 'C', 姓名: '邓清怡', 学号: '999999999', 院系: '商学院', 邮箱: '不是邮箱' },
    ],
  });
  const found = await findDirectoryMembers(client, '邓清怡');
  assert.equal(found.members.length, 2, '同一学号的历史重复行只保留一条');
  assert.equal(found.members[1].email, '', '非法邮箱留空而不是原样带出');
  assert.equal(found.truncated, false);
});

test('名册检索：数据库不可用时报 503，不返回空结果冒充「查无此人」', async () => {
  await assert.rejects(
    () => findDirectoryMembers(makeClient({ failQuery: true }), '汤艺暄'),
    (error) => error.statusCode === 503 && error.code === 'member_directory_unavailable',
  );
});

/* -------------------------------------------------------------- 初审登记美编 */

test('初审通过未登记美编：拒（400 manual_editor_required）', async () => {
  const client = makeClient();
  await assert.rejects(
    () => applyReviewStep(stepContext(client, { body: { manualEditor: null } })),
    (error) => error.statusCode === 400 && error.code === 'manual_editor_required',
  );
  assert.equal(client.calls.updates.length, 0, '被拒时不得写库');
});

test('初审登记的美编不在名册：拒（400 manual_editor_not_found）', async () => {
  await assert.rejects(
    () => applyReviewStep(stepContext(makeClient(), { members: [], body: { manualEditor: { name: '查无此人' } } })),
    (error) => error.statusCode === 400 && error.code === 'manual_editor_not_found',
  );
});

test('只填姓名命中多人：拒并要求改填学号', async () => {
  const twins = [
    { name: '邓清怡', studentId: '251250217', faculty: '商学院', email: '' },
    { name: '邓清怡', studentId: '251250218', faculty: '商学院', email: '' },
  ];
  await assert.rejects(
    () => applyReviewStep(stepContext(makeClient(), { members: twins, body: { manualEditor: { name: '邓清怡' } } })),
    (error) => error.statusCode === 400 && error.code === 'manual_editor_ambiguous' && error.candidates.length === 2,
  );
  // 补上学号即可唯一定位
  const client = makeClient();
  const done = await applyReviewStep(stepContext(client, { members: twins, body: { manualEditor: { studentId: '251250218' } } }));
  assert.equal(done.manualEditor.studentId, '251250218');
  assert.equal(client.calls.updates.length, 1);
});

test('初审通过登记美编：写 美编人/美编学号，并把快照落进轨迹', async () => {
  const client = makeClient();
  const result = await applyReviewStep(stepContext(client, { body: { manualEditor: { name: '汤艺暄' } } }));

  assert.equal(result.manualEditor.name, '汤艺暄');
  assert.equal(result.manualEditor.studentId, '251880248');
  assert.equal(result.manualEditor.email, '251880248@smail.nju.edu.cn', '邮箱由名册带出，不手填');

  const patch = client.calls.updates[0].patch;
  assert.equal(patch['美编人'], '汤艺暄', '表列可读：直接存姓名');
  assert.equal(patch['美编学号'], '251880248', '学号单独一列，不塞进姓名串');
  const trail = JSON.parse(patch['审核轨迹']);
  assert.deepEqual(trail.at(-1).manualEditor, TANG, '轨迹留快照，终审不必再查名册');
  assert.equal(trail.at(-1).reviewerName, '王诺', '轨迹同时留实名，台账要写姓名不是登录名');
});

test('退回不走美编登记：不需要 manualEditor', async () => {
  const client = makeClient();
  const result = await applyReviewStep(stepContext(client, {
    body: { decision: 'return', note: '第二段数据要核对', manualEditor: null },
  }));
  assert.equal(result.manualEditor, null);
  assert.equal(client.calls.updates[0].patch['美编人'], undefined, '退回不写美编列');
});

/* ---------------------------------------------------------- 终审日期与台账写入 */

test('预期发布时间：只接受真实的 YYYY-MM-DD', () => {
  assert.equal(normalizePublishDate('2026-11-27'), '2026-11-27');
  assert.equal(normalizePublishDate(' 2026-11-27 '), '2026-11-27');
  assert.equal(normalizePublishDate(''), '');
  assert.equal(normalizePublishDate('2026/11/27'), '', '分隔符必须一致');
  assert.equal(normalizePublishDate('2026-02-30'), '', '不存在的日期要拦住');
  assert.equal(normalizePublishDate('2026-13-01'), '');
  assert.equal(normalizePublishDate('26-11-27'), '');
});

test('终审通过未填发布时间：拒（400 publish_date_required）', async () => {
  const client = makeClient();
  await assert.rejects(
    () => applyReviewStep(stepContext(client, { shape: FINAL_SHAPE, account: REVIEWER, body: { expectedPublishDate: '' } })),
    (error) => error.statusCode === 400 && error.code === 'publish_date_required',
  );
  assert.equal(client.calls.updates.length, 0, '日期缺失时不推进状态');
});

test('终审通过带日期：正常推进并回传规范化日期', async () => {
  const client = makeClient();
  const result = await applyReviewStep(stepContext(client, {
    shape: FINAL_SHAPE, account: REVIEWER, body: { expectedPublishDate: '2026-11-27' },
  }));
  assert.equal(result.advance.done, true);
  assert.equal(result.publishDate, '2026-11-27');
  assert.equal(result.isFinalLevel, true);
});

test('台账行：九个目标字段全部落地', () => {
  const { row, missing } = buildTemplateRow({
    title: '活动总结 | 青春有方，健康无虞',
    articleCategory: '活动总结',
    publishDate: '2026-11-27',
    writer: { name: '杨德丹', studentId: '241820262', email: '241820262@smail.nju.edu.cn' },
    editor: TANG,
    initialReviewer: '王诺',
    finalReviewer: '金中宸',
  });

  assert.deepEqual(missing, [], '来源齐备时不应缺项');
  assert.equal(row['类别'], '活动总结');
  assert.equal(row['预期发布时间'], '2026-11-27');
  assert.equal(row['推文标题'], '活动总结 | 青春有方，健康无虞');
  assert.equal(row['文编姓名'], '杨德丹');
  assert.equal(row['文编学号'], '241820262');
  assert.equal(row['美编姓名'], '汤艺暄');
  assert.equal(row['美编学号'], '251880248');
  assert.equal(row['美编初审/对接人'], '王诺');
  assert.equal(row['美编终审人'], '金中宸');
  // 不写没有权威来源的列
  assert.equal(row['阶段'], undefined, '阶段是人工推进的复合选项，不自动预设');
  assert.equal(row['类型'], undefined, '贴图/总结推文/共创推文需人判断');
  assert.equal(row['美编审核状态'], undefined, '美编还没做，不能预设通过');
  assert.equal(row['文编部门'], undefined, '名册只有院系，没有综事/生命/博爱/苏州口径');
});

test('台账行：类别不在目标表选项内就留空，不污染下拉选项', () => {
  const { row, categorySkipped } = buildTemplateRow({
    title: 'T', articleCategory: '高校多病共防（自拟）', publishDate: '2026-11-27',
    writer: { name: 'A', studentId: '1' }, editor: { name: 'B', studentId: '2' },
  });
  assert.equal(categorySkipped, '高校多病共防（自拟）');
  assert.equal(row['类别'], undefined);
});

test('台账写入：成功建行，标题与文编学号进查询条件', async () => {
  const client = makeClient({ rows: [] });
  const result = await syncTemplateRow({
    client, trail: FINAL_SHAPE.reviewTrail, submission: FINAL_SHAPE,
    publishDate: '2026-11-27', finalReviewer: '金中宸',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.reason, 'created');
  assert.equal(result.rowId, 'TPL-1');
  const sql = client.calls.queries[0];
  assert.match(sql, /推文标题/, '判重必须带标题');
  assert.match(sql, /文编学号/, '同名标题要靠文编学号区分不同期');
  assert.equal(client.calls.inserts[0].table, '新媒体审核表');
});

test('台账写入：已存在同一行则跳过，不重复建', async () => {
  const client = makeClient({ rows: [{ _id: 'EXIST-1' }] });
  const result = await syncTemplateRow({
    client, trail: FINAL_SHAPE.reviewTrail, submission: FINAL_SHAPE,
    publishDate: '2026-11-27', finalReviewer: '金中宸',
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'exists');
  assert.equal(client.calls.inserts.length, 0);
});

test('台账写入：查重失败时拒写，不赌「大概没有重复」', async () => {
  const client = makeClient({ failQuery: true });
  const result = await syncTemplateRow({
    client, trail: FINAL_SHAPE.reviewTrail, submission: FINAL_SHAPE,
    publishDate: '2026-11-27', finalReviewer: '金中宸',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'dedupe_failed');
  assert.equal(client.calls.inserts.length, 0);
});

test('台账写入：初审没登记美编时明确报缺项，而不是写半行', async () => {
  const trailWithoutEditor = JSON.stringify([{ level: 1, decision: 'approve', reviewerName: '王诺' }]);
  const client = makeClient({ rows: [] });
  const result = await syncTemplateRow({
    client, trail: trailWithoutEditor, submission: FINAL_SHAPE,
    publishDate: '2026-11-27', finalReviewer: '金中宸',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'incomplete');
  assert.deepEqual(result.missing, ['美编姓名', '美编学号']);
  assert.equal(client.calls.inserts.length, 0, '缺项时不写库，避免半行台账');
});
