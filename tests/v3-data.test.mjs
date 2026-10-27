import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePenName,
  PEN_NAME_MIN,
  PEN_NAME_MAX,
  MEDIA_OTHER_DIR,
  MEDIA_OTHER_DIR_LEGACY,
  MEDIA_UNCLASSIFIED_DEPARTMENT,
  MEDIA_UNNAMED_ACTIVITY,
  MEDIA_PHOTO_DIR_TEMPLATE,
  NAMING_DECISION,
  REVIEW_CHAINS,
  reviewChainFor,
  finalReviewLevel,
  PUBLISH_FORMS,
  normalizePublishForm,
  ARTICLE_CATEGORIES,
  SHOWCASE_GROUPS,
  DESIGN_WORKGROUP_DIR,
  DESIGN_CATEGORIES,
  groupBySection,
  CHECKLIST_SEED,
  MEDIA_PICK_STATUS,
  MEDIA_PICK_MIN,
  MEDIA_PICK_MAX,
  MEDIA_DELETE_STATUS,
  SKILL_LEVELS,
  mediaDepartmentDir,
  mediaActivityDir,
  mediaPhotoDir,
  mediaOtherDir,
  mediaStoragePath,
  submissionStoragePath,
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

test('v3.1 命名决策：库根/<部门>/<活动名>/<活动名>-照片，其他文件落二级目录', () => {
  // 三级结构定案（2026-10-11）：一级=部门，二级=活动名，三级=<活动名>-照片。
  assert.equal(MEDIA_UNCLASSIFIED_DEPARTMENT, '未归类', '缺部门的兜底目录名');
  assert.equal(MEDIA_UNNAMED_ACTIVITY, '未命名活动', '缺活动名的兜底目录名');
  assert.equal(MEDIA_PHOTO_DIR_TEMPLATE, '{activity}-照片');
  assert.equal(NAMING_DECISION.decidedAt, '2026-10-11');
  assert.match(NAMING_DECISION.layout, /<部门>\/<活动名>/);
  // 旧名仅保留为兼容常量，构造函数不再返回它们。
  assert.equal(MEDIA_OTHER_DIR_LEGACY, '其他文件');
  assert.equal(MEDIA_OTHER_DIR, '其他资料', '旧版「其他资料」常量保留用于识别历史路径');
  assert.equal(mediaOtherDir(), '', 'v3.1 其他文件直接落二级活动目录，不再单建子目录');
});

test('v3.1 三级目录构造：/<部门>/<活动名>/<活动名>-照片', () => {
  assert.equal(mediaDepartmentDir('生命中心'), '生命中心', '一级目录即部门名');
  assert.equal(mediaDepartmentDir(''), MEDIA_UNCLASSIFIED_DEPARTMENT, '缺部门兜底「未归类」');
  assert.equal(mediaActivityDir('献血活动'), '献血活动', '二级目录即活动名');
  assert.equal(mediaActivityDir(''), MEDIA_UNNAMED_ACTIVITY, '缺活动名兜底');
  assert.equal(mediaPhotoDir('献血活动'), '献血活动-照片', '三级目录 = 活动名-照片');

  const photo = mediaStoragePath('无偿献血进校园', '博爱中心');
  assert.equal(photo.department, '博爱中心');
  assert.equal(photo.activityDir, '无偿献血进校园');
  assert.equal(photo.dir, '/博爱中心/无偿献血进校园/无偿献血进校园-照片');
  // 其他文件落二级目录本体，不带三级子目录。
  const other = mediaStoragePath('无偿献血进校园', '博爱中心', { subdir: 'other' });
  assert.equal(other.dir, '/博爱中心/无偿献血进校园');
  assert.equal(other.subdir, '');
  // 非法字符被清洗，且不产生双斜杠。
  const dirty = mediaStoragePath('活动/一', '生命中心');
  assert.equal(dirty.dir, '/生命中心/活动 一/活动 一-照片');
  assert.ok(!dirty.dir.includes('//'));
});

test('v3.1 投稿附件落点：/<部门>/<活动名>/<附件ID>', () => {
  const article = submissionStoragePath({ center: '博爱中心', activity: '急救培训 AED', attachmentId: 'ATT-1' });
  assert.equal(article.department, '博爱中心');
  assert.equal(article.activityDir, '急救培训 AED');
  assert.equal(article.dir, '/博爱中心/急救培训 AED/ATT-1');
  // 有部门时一律按部门/活动归档（文创若显式给了部门，也走这条）。
  const design = submissionStoragePath({ center: '综事中心', activity: '文创征集', attachmentId: 'ATT-2' });
  assert.equal(design.dir, '/综事中心/文创征集/ATT-2');
  // 没有部门 = 文创设计投稿：固定落 /文创设计工作组/<附件ID>。
  const bare = submissionStoragePath({ attachmentId: 'ATT-3' });
  assert.equal(bare.dir, `/${DESIGN_WORKGROUP_DIR}/ATT-3`);
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
  // 2026-10-27 定案：展示墙不再用 3 个粗分类，直接复用公众号 11 栏目（与投稿同一份字典）。
  assert.deepEqual([...SHOWCASE_GROUPS], [...ARTICLE_CATEGORIES], '展示分类 = 公众号 11 栏目');
  assert.equal(CHECKLIST_SEED.length, 21, '审核清单 21 项');
  // 检查项按 8 类分组（内容/表述/隐私/图片/格式/排版/后台/发布）
  const categories = [...new Set(CHECKLIST_SEED.map((x) => x.category))];
  assert.equal(categories.length, 8);
  assert.deepEqual(categories, ['内容', '表述', '隐私', '图片', '格式', '排版', '后台', '发布']);
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
  // 2026-10-27：字典已换成公众号 11 栏目，「新闻」不再是合法栏目（对应「红会新闻」）。
  const items = [
    { group: '红会新闻', title: 'a' },
    { group: '活动总结', title: 'b' },
    { group: '活动总结', title: 'c' },
    { group: '未知名类', title: 'd' },
    { group: '', title: 'e' },
  ];
  const groups = groupBySection(items, { key: 'group', preferred: SHOWCASE_GROUPS, fallback: '精选推荐' });
  assert.deepEqual(groups.map((g) => g.name), ['活动总结', '红会新闻', '精选推荐']);
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
