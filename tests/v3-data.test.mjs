import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePenName,
  PEN_NAME_MIN,
  PEN_NAME_MAX,
  MEDIA_OTHER_DIR,
  MEDIA_OTHER_DIR_LEGACY,
  NAMING_DECISION,
  SUBMISSION_SUBDIRS,
  REVIEW_CHAINS,
  reviewChainFor,
  finalReviewLevel,
  PUBLISH_FORMS,
  normalizePublishForm,
  ARTICLE_CATEGORIES,
  SHOWCASE_GROUPS,
  DESIGN_CATEGORIES,
  groupBySection,
  CHECKLIST_SEED,
  MEDIA_PICK_STATUS,
  MEDIA_PICK_MIN,
  MEDIA_PICK_MAX,
  MEDIA_DELETE_STATUS,
  SKILL_LEVELS,
  mediaActivityDir,
  mediaPhotoDir,
  mediaOtherDir,
  MEDIA_COLUMNS,
} from '../lib/attachment/store.js';

/* -------------------------------------------------------------------------- *
 * v3 S1：数据契约层单测（笔名 / 字典 / 审核链 / 发布形式 / 命名决策）
 * -------------------------------------------------------------------------- */

test('笔名规范化：长度边界与空白处理', () => {
  assert.equal(normalizePenName('  小  红  '), '小 红', '内部空白压为单空格、去首尾');
  assert.equal(normalizePenName('ab'), 'ab', '最小长度 2 通过');
  assert.equal(normalizePenName('a'), '', '低于最小长度拒绝');
  assert.equal(normalizePenName('a'.repeat(PEN_NAME_MAX)), 'a'.repeat(PEN_NAME_MAX), '等于最大长度通过');
  assert.equal(normalizePenName('a'.repeat(PEN_NAME_MAX + 1)), '', '超过最大长度拒绝');
  assert.equal(normalizePenName(''), '', '空串拒绝');
  assert.equal(normalizePenName(null), '', 'null 拒绝');
  assert.equal(PEN_NAME_MIN, 2);
  assert.equal(PEN_NAME_MAX, 16);
});

test('Q4 命名决策：其他文件目录改为「其他资料」', () => {
  assert.equal(MEDIA_OTHER_DIR, '其他资料', 'Q4 本轮确认的新命名');
  assert.equal(MEDIA_OTHER_DIR_LEGACY, '其他文件', '旧命名保留为兼容常量');
  assert.equal(NAMING_DECISION.otherFilesDir, '其他资料');
  assert.equal(NAMING_DECISION.decidedAt, '2026-10-10');
  assert.equal(mediaOtherDir(), '其他资料', '目录构造函数返回新命名');
});

test('v3 影像目录构造：<活动名>-<中心> / <活动名>-照片 / 其他资料', () => {
  assert.equal(mediaActivityDir('献血活动', '生命中心'), '献血活动-生命中心');
  assert.equal(mediaPhotoDir('献血活动'), '献血活动-照片');
  assert.equal(mediaActivityDir('献血活动', ''), '献血活动', '缺中心时退化为活动名');
  assert.equal(mediaActivityDir('', '博爱中心'), '未命名活动-博爱中心', '缺活动名时兜底');
  // 非法字符被清洗
  assert.equal(mediaActivityDir('活动/一', '生命中心'), '活动 一-生命中心');
});

test('投稿分类子目录：article → 文字稿件，design → 文创设计', () => {
  assert.equal(SUBMISSION_SUBDIRS.article, '文字稿件');
  assert.equal(SUBMISSION_SUBDIRS.design, '文创设计');
});

test('审核链：文字 2 级 / 文创 3 级 / 小绿书 2 级（N3 用户确认走二级）', () => {
  assert.equal(REVIEW_CHAINS.article.length, 2);
  assert.equal(REVIEW_CHAINS.design.length, 3);
  assert.equal(REVIEW_CHAINS.brief.length, 2, 'N3-a：小绿书同样走二级审核');
  assert.equal(finalReviewLevel('article'), 2);
  assert.equal(finalReviewLevel('design'), 3);
  assert.equal(finalReviewLevel('brief'), 2);
  // 未知 kind 退化为 article 链
  assert.equal(reviewChainFor('unknown').length, 2);
  // 链的 level 连续从 1 起
  for (const key of Object.keys(REVIEW_CHAINS)) {
    REVIEW_CHAINS[key].forEach((step, index) => {
      assert.equal(step.level, index + 1, `${key} 链 level 连续`);
      assert.ok(step.name && step.role, `${key} 链每级有名称与角色`);
    });
  }
});

test('发布形式：仅大推文 / 小绿书', () => {
  assert.deepEqual([...PUBLISH_FORMS], ['大推文', '小绿书']);
  assert.equal(normalizePublishForm('大推文'), '大推文');
  assert.equal(normalizePublishForm('小绿书'), '小绿书');
  assert.equal(normalizePublishForm('大文章'), '', '非法值拒绝');
  assert.equal(normalizePublishForm(''), '', '空值拒绝');
});

test('字典常量：11 审核栏目 + 3 展示分类 + 21 检查项', () => {
  assert.equal(ARTICLE_CATEGORIES.length, 11, '制度 11 栏目');
  assert.ok(ARTICLE_CATEGORIES.includes('活动总结'));
  assert.ok(ARTICLE_CATEGORIES.includes('人道法言'));
  assert.deepEqual([...SHOWCASE_GROUPS], ['活动总结', '暑期专项', '新闻'], '展示分类 3 个');
  assert.equal(CHECKLIST_SEED.length, 21, '审核清单 21 项');
  // 检查项按 7 类分组
  const categories = [...new Set(CHECKLIST_SEED.map((x) => x.category))];
  assert.equal(categories.length, 7);
  // 每项都有标准
  assert.ok(CHECKLIST_SEED.every((x) => x.item && x.standard));
});

test('精选与删除状态机常量', () => {
  assert.equal(MEDIA_PICK_STATUS.none, '未申请');
  assert.equal(MEDIA_PICK_STATUS.pending, '已申请待确认');
  assert.equal(MEDIA_PICK_STATUS.picked, '已精选');
  assert.equal(MEDIA_PICK_STATUS.rejected, '已驳回');
  assert.equal(MEDIA_PICK_MIN, 3);
  assert.equal(MEDIA_PICK_MAX, 5);
  assert.equal(MEDIA_DELETE_STATUS.pending, '待审核');
});

/* -------------------------------------------------------------------------- *
 * v3 S6：展示墙双板分节（第 14 项）+ 文创类型字典（第 15 项）
 * -------------------------------------------------------------------------- */

test('groupBySection：按字典分节，未命中归「其他」，空值归 fallback，preferred 排序', () => {
  const items = [
    { group: '新闻', title: 'a' },
    { group: '活动总结', title: 'b' },
    { group: '活动总结', title: 'c' },
    { group: '未知名类', title: 'd' },
    { group: '', title: 'e' },
  ];
  const groups = groupBySection(items, { key: 'group', preferred: SHOWCASE_GROUPS, fallback: '精选推荐' });
  assert.deepEqual(groups.map((g) => g.name), ['活动总结', '新闻', '精选推荐']);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[2].items.length, 2, '未知名类 + 空值都归 fallback');
});

test('groupBySection：无字典时按原值分节', () => {
  const groups = groupBySection([{ group: 'A' }, { group: 'B' }, { group: 'A' }], { key: 'group' });
  assert.deepEqual(groups.map((g) => g.name).sort(), ['A', 'B']);
});

test('文创类型字典：7 类且与设计投稿口径一致', () => {
  assert.deepEqual([...DESIGN_CATEGORIES], ['徽章', '贴纸', '卡牌', '表情包', '海报', '文创周边', '其他']);
});


test('技能星级 1-5 档位完整', () => {
  assert.equal(SKILL_LEVELS.length, 5);
  SKILL_LEVELS.forEach((item, index) => {
    assert.equal(item.level, index + 1);
    assert.ok(item.label && item.hint);
  });
});

test('影像素材表列扩展：含精选 6 列 + 删除 4 列', () => {
  for (const col of ['精选状态', '精选申请时间', '精选确认人', '精选确认时间', '精选库路径', '精选库ID']) {
    assert.ok(MEDIA_COLUMNS.includes(col), `缺少 ${col}`);
  }
  for (const col of ['删除申请状态', '删除理由', '删除审核人', '删除审核时间']) {
    assert.ok(MEDIA_COLUMNS.includes(col), `缺少 ${col}`);
  }
  assert.equal(MEDIA_COLUMNS.length, 24);
});
