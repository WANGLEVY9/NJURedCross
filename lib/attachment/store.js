/**
 * 内容投稿附件的表契约与行映射。
 *
 * 「投稿附件表」承载投稿模块的文件元数据；文件本体存放在外部对象存储
 * （首选阿里云 OSS 私有 Bucket，见 oss.js），本表只保存引用与状态，
 * 对齐 lib/events/njubox.js 活动附件表的既有模式：
 *   · 表名与列名集中在常量，schema 脚本与业务路由共用同一来源
 *   · 所有列按仓库惯例建为 text；数值（大小）以字符串落表
 *   · 行映射保持纯函数，不触碰网络、不读取配置，可被离线测试导入
 */

import { randomBytes } from 'node:crypto';

export const SUBMISSION_ATTACHMENT_TABLE = '投稿附件表';

export const SUBMISSION_ATTACHMENT_COLUMNS = [
  '附件ID', '投稿ID', '文件名', 'MIME类型', '大小', '校验和',
  '存储提供商', 'Bucket', '对象Key', '上传状态', '上传人', '上传时间', '绑定时间',
  // v3.1 存储归位：附件落 /<部门>/<活动名>/<附件ID>/，这两列在申请槽位时写入。
  '中心', '活动名',
];

/** 外部存储提供商标识。v2 起主路线为 NJU Box（Seafile），OSS 保留兼容历史行。 */
export const ATTACHMENT_PROVIDER_ALIYUN_OSS = 'aliyun-oss';
export const ATTACHMENT_PROVIDER_NJUBOX = 'njubox';

/**
 * 「影像素材表」：活动照片归档（影像模块）。文件本体存 NJU Box 的
 * /<部门>/<活动名>/<活动名>-照片/ 目录；本表保存元数据与留用状态。
 */
export const MEDIA_TABLE = '影像素材表';
export const MEDIA_COLUMNS = [
  '照片ID', '中心', '活动名', '摄影师', '文件名', 'MIME类型', '大小', '校验和',
  '存储提供商', '库ID', '文件路径', '留用状态', '上传人', '上传时间',
  // v3 双库精选（N1）
  '精选状态', '精选申请时间', '精选确认人', '精选确认时间', '精选库路径', '精选库ID',
  // v3 删除审核（第 9 项）
  '删除申请状态', '删除理由', '删除审核人', '删除审核时间',
];

/**
 * 归档中心（原「服务队」概念，2026-10 按用户要求改为固定中心分类）。
 * 上传影像时必选其一；禁用值以外的中心名一律拒绝，保证 Box 目录不被脏数据污染。
 *
 * 2026-10-27：按用户定案去掉「苏州分部」，固定四项。
 * 活动广场的分类名（7 类，见 public/app/shared/activity-taxonomy.js）不直接等于
 * 这里的部门名，读取活动项目表时经 activities.js 的映射表翻译后再比对。
 */
export const MEDIA_CENTERS = Object.freeze([
  '生命中心', '博爱中心', '综事中心', '主席团活动',
]);

/** 中心名白名单校验：返回规范化中心名，或空串（非法/缺失）。 */
export function normalizeMediaCenter(value) {
  const name = String(value ?? '').trim();
  return MEDIA_CENTERS.includes(name) ? name : '';
}

/* --------------------------------------------------------------------------
   v3.1 存储架构（2026-10-11 用户定案）：按部门的三级目录
   库根（「平台文件存储」库）/
     <部门>/                          ← 一级：四个部门（= MEDIA_CENTERS）
       <活动名>/                      ← 二级：活动名称
         <活动名>-照片/               ← 三级：影像照片
         <其他文件名>                 ← 影像其他文件直接落二级目录（不再单建子目录）
         <投稿附件ID>/<文件名>         ← 投稿附件：二级目录下按附件ID分子目录
   精选照片仍复制到精选库的同名目录，结构不变（N1）。
   宣传展示封面沿用 /宣传展示/。
   -------------------------------------------------------------------------- */

/** 仍在使用的固定根目录（展示封面）。 */
export const STORAGE_ROOTS = Object.freeze({
  showcase: '/宣传展示',
});

/** v3.1 前使用的两个根目录，仅用于识别历史路径，不再写入。 */
export const STORAGE_ROOTS_LEGACY = Object.freeze({
  submissions: '/内容投稿',
  media: '/影像素材',
});

/** 部门缺省时的兜底目录名（不应出现在正常流程里，仅防脏数据）。 */
export const MEDIA_UNCLASSIFIED_DEPARTMENT = '未归类';
/** 活动名缺省时的兜底目录名。 */
export const MEDIA_UNNAMED_ACTIVITY = '未命名活动';

/** 影像三级目录名模板。 */
export const MEDIA_PHOTO_DIR_TEMPLATE = '{activity}-照片';

/**
 * @deprecated v3.1 起「其他文件」直接落二级活动目录，不再单建子目录。
 * 常量保留用于识别历史路径与兼容旧数据。
 */
export const MEDIA_OTHER_DIR = '其他资料';
export const MEDIA_OTHER_DIR_LEGACY = '其他文件';

/**
 * @deprecated v3.1 起投稿不再按稿件类型分层（改按 部门/活动）。
 * 常量保留用于识别历史路径。
 * 键与投稿 kind 对应：article → 文字稿件，design → 文创设计。
 */
export const SUBMISSION_SUBDIRS = Object.freeze({
  article: '文字稿件',
  design: '文创设计',
});

/** v3.1 命名决策记录（供文档与测试引用）。 */
export const NAMING_DECISION = Object.freeze({
  layout: '库根/<部门>/<活动名>/{<活动名>-照片, 其他文件, <附件ID>/}',
  rationale: '2026-10-11 用户定案：图片与文稿统一按「部门 → 活动」归位，活动目录下再分「<活动名>-照片」存放照片，其他文件与投稿附件同层；精选照片仍复制到精选库，结构不变。',
  decidedAt: '2026-10-11',
});

/* --------------------------------------------------------------------------
   v3 笔名（第 3/12 项）：首次填写即绑定，绑定后不可改
   -------------------------------------------------------------------------- */

/** 笔名长度约束（服务端与前端共用）。 */
export const PEN_NAME_MIN = 2;
export const PEN_NAME_MAX = 16;

/** 笔名规范化：去首尾空白、压内部空白。返回空串表示无效。 */
export function normalizePenName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < PEN_NAME_MIN || name.length > PEN_NAME_MAX) return '';
  return name;
}

/* --------------------------------------------------------------------------
   v3 多级审核状态机（第 6/7 项，§4.1）
   -------------------------------------------------------------------------- */

/**
 * 审核链定义（服务端权威；可被「宣传对接人表」覆盖）。
 * 文字稿件 = 2 级；文创设计 = 3 级（前两级常为同一人）。
 * level 从 1 起；最后一级的 level 即「末级」。
 */
export const REVIEW_CHAINS = Object.freeze({
  article: Object.freeze([
    Object.freeze({ level: 1, name: '对接人初审（含美编招募）', role: 'outreach_liaison' }),
    Object.freeze({ level: 2, name: '审核人终审', role: 'outreach_reviewer' }),
  ]),
  design: Object.freeze([
    Object.freeze({ level: 1, name: '草稿/线稿定稿', role: 'outreach_liaison' }),
    Object.freeze({ level: 2, name: '上色铺色', role: 'outreach_liaison' }),
    Object.freeze({ level: 3, name: '成稿终审', role: 'outreach_reviewer' }),
  ]),
  // N3：小绿书走二级审核（用户 2026-10-10 明确确认）
  brief: Object.freeze([
    Object.freeze({ level: 1, name: '对接人初审', role: 'outreach_liaison' }),
    Object.freeze({ level: 2, name: '审核人终审', role: 'outreach_reviewer' }),
  ]),
});

/** 取审核链（未知 kind 退化为 article 链）。 */
export function reviewChainFor(kind) {
  return REVIEW_CHAINS[kind] || REVIEW_CHAINS.article;
}

/** 末级 level（该链最后一级）。 */
export function finalReviewLevel(kind) {
  const chain = reviewChainFor(kind);
  return chain[chain.length - 1].level;
}

/** 审核层级初值：0 = 待初审；末级 + 已通过 = 终审完成。 */
export const REVIEW_LEVEL_INITIAL = 0;

/* --------------------------------------------------------------------------
   v3 发布形式（N3）
   -------------------------------------------------------------------------- */

export const PUBLISH_FORMS = Object.freeze(['大推文', '小绿书']);

/** 发布形式白名单校验。 */
export function normalizePublishForm(value) {
  const form = String(value ?? '').trim();
  return PUBLISH_FORMS.includes(form) ? form : '';
}

/** 推文类别（制度 11 栏目，§4.0）——「审核类别」字典。 */
export const ARTICLE_CATEGORIES = Object.freeze([
  '小红帮推', '活动预热', '活动总结', '健康小蓝鲸', '今日节日', '心灵慢车',
  '南男女侣', '红会新闻', '南小红月报', '人道法言', '红会招新',
]);

/**
 * 展示分类 ——「展示分类」字典。
 *
 * 2026-10-27 定案：展示墙不再用「活动总结 / 暑期专项 / 新闻」三个粗分类，
 * 改为**直接复用公众号 11 栏目**（与投稿页「推文栏目」、审核按栏目选人是同一份
 * 字典 ARTICLE_CATEGORIES），保证「投的栏目 = 展示墙的分节」一一对应。
 */
export const SHOWCASE_GROUPS = ARTICLE_CATEGORIES;

/**
 * 文创设计投稿的固定云盘目录：不走「部门 + 活动」，统一落在
 * /内容投稿/文创设计工作组/<附件ID> —— 与历史结构里的「内容投稿/文字稿件」并列，
 * 运营在云盘里一眼能把「文字稿件」和「文创设计工作组」看成同一层。
 */
export const DESIGN_WORKGROUP_PARENT = '内容投稿';
export const DESIGN_WORKGROUP_DIR = '文创设计工作组';
/** 完整目录（相对库根，含父级）：/内容投稿/文创设计工作组 */
export const DESIGN_WORKGROUP_PATH = `/${DESIGN_WORKGROUP_PARENT}/${DESIGN_WORKGROUP_DIR}`;

/** 文创类型字典（第 5/15 项）——「文创展示」按此分节。与 server.js DESIGN_CATEGORIES_DICT 对齐。 */
export const DESIGN_CATEGORIES = Object.freeze(['徽章', '贴纸', '卡牌', '表情包', '海报', '文创周边', '其他']);

/**
 * 通用分节：把条目按某个取值字段分组，并按 preferred 顺序优先排列。
 * 未命中字典的取值统一归入「其他」；空取值归入 fallback。
 * 与展示墙「公众号推文按展示分类 / 文创展示按文创类别」两处共用。
 */
export function groupBySection(items = [], { key = 'group', preferred = [], fallback = '其他', order = null } = {}) {
  const buckets = new Map();
  const push = (name, item) => {
    if (!buckets.has(name)) buckets.set(name, []);
    buckets.get(name).push(item);
  };
  for (const item of items) {
    const raw = String(item[key] ?? '').trim();
    const name = preferred.length && !preferred.includes(raw) ? fallback : (raw || fallback);
    push(name, item);
  }
  let names = [...buckets.keys()];
  if (preferred.length) {
    const rank = (name) => {
      const idx = preferred.indexOf(name);
      return idx === -1 ? preferred.length + 1 : idx;
    };
    names = names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh'));
  } else if (typeof order === 'function') {
    names = names.sort(order);
  }
  return names.map((name) => ({ name, items: buckets.get(name) }));
}

/* --------------------------------------------------------------------------
   v3 双库精选（N1 / D8，复制模式）
   -------------------------------------------------------------------------- */

export const MEDIA_PICK_STATUS = Object.freeze({
  none: '未申请',
  pending: '已申请待确认',
  picked: '已精选',
  rejected: '已驳回',
});

export const MEDIA_PICK_MIN = 3;
export const MEDIA_PICK_MAX = 5;

/** 删除申请状态机（第 9 项）。 */
export const MEDIA_DELETE_STATUS = Object.freeze({
  none: '未申请',
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
});

/* --------------------------------------------------------------------------
   v3 任务与技能（第 8 项 / D3 / D6）
   -------------------------------------------------------------------------- */

export const TASK_TABLE = '任务表';
export const TASK_COLUMNS = [
  '任务ID', '标题', '说明', '类型', '星级要求', '发布人', '状态', '发布时间', '认领人', '认领时间',
  // v3.1：发布任务时附带的技能要求（技能名称 + 所需星级）
  '技能要求', '要求星级',
];

export const TASK_CLAIM_TABLE = '任务申领表';
export const TASK_CLAIM_COLUMNS = [
  '申领ID', '任务ID', '申领人', '状态', '时间', '说明',
  // v3.1：申领需管理员审核，审核结论留痕
  '审核人', '审核时间', '审核意见',
];

export const TASK_STATUS = Object.freeze({
  open: '待认领',
  reviewing: '申领审核中',
  claimed: '已认领',
  closed: '已关闭',
});

/** v3.1 任务申领状态机：待审核 → 已通过 / 已驳回。 */
export const CLAIM_STATUS = Object.freeze({
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
});

export const SKILL_TABLE = '成员技能表';
export const SKILL_COLUMNS = [
  '技能ID', '账号', '技能名', '说明', '证明文件', '自评星级', '状态', '审核人', '审核意见', '提交时间',
  // v3.1：常用软件（多选，存 JSON 数组文本）
  '常用软件',
];

export const SKILL_STATUS = Object.freeze({ pending: '待审核', approved: '已通过', rejected: '已驳回' });

/* --------------------------------------------------------------------------
   v3.1 技能认证字典（2026-10-11 用户定案）
   -------------------------------------------------------------------------- */

/** 「其他」选项：选中后需手填具体值。 */
export const SKILL_OTHER = '其他';

/** 技能名称（8 项，下拉选择；选「其他」需手填）。 */
export const SKILL_NAMES = Object.freeze([
  '图片处理', '公众号排版', '海报设计', '绘图与二创',
  '板写与 logo 设计', '动画与 live 2D', '3D建模', '其他',
]);

/** 常用软件（13 项，多选；选「其他」需手填）。 */
export const SKILL_SOFTWARES = Object.freeze([
  'Procreate', '画世界 pro', '天生会画', 'PS', 'AI', 'Canva', '秀米',
  'Tinkercad', 'Blender', '3Dmax', 'AE', 'Live2D Cubism Editor', '其他',
]);

/** 选中该技能名称时，往期作品提交链接必填。 */
export const SKILL_PORTFOLIO_REQUIRED_FOR = '绘图与二创';

/** 常用软件序列化：数组 ↔ JSON 文本（列存 JSON，容忍历史空值）。 */
export function formatSkillSoftwares(list) {
  const values = [...new Set((Array.isArray(list) ? list : [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean))];
  return values.length ? JSON.stringify(values) : '';
}

/** 解析「常用软件」列：JSON 数组文本 → 字符串数组；解析失败回退空数组。 */
export function parseSkillSoftwares(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
  } catch { /* 非 JSON：按顿号/逗号分隔兜底 */ }
  return raw.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
}

/** 技能星级档位（1-5，含含义）。 */
export const SKILL_LEVELS = Object.freeze([
  Object.freeze({ level: 1, label: '了解', hint: '能看懂、能跟着做' }),
  Object.freeze({ level: 2, label: '熟练', hint: '能独立完成常规任务' }),
  Object.freeze({ level: 3, label: '精通', hint: '能独立完成并处理疑难' }),
  Object.freeze({ level: 4, label: '能手', hint: '能带人、能定标准' }),
  Object.freeze({ level: 5, label: '专家', hint: '能独立开设培训' }),
]);

/* --------------------------------------------------------------------------
   v3 意见回传模板（§6，21 项清单）
   -------------------------------------------------------------------------- */

export const CHECKLIST_TABLE = '审核清单模板表';
export const CHECKLIST_COLUMNS = ['模板ID', '适用类型', '类别', '检查项', '标准', '排序', '启用'];

/**
 * 21 项检查项 seed —— 逐字对齐《南京大学红十字会公众号美编审核清单》
 * （制作人：金中宸 王诺），共 8 类：内容/表述/隐私/图片/格式/排版/后台/发布。
 * 修改此表即可改后台「审核清单模板表」，无需改代码。
 */
export const CHECKLIST_SEED = Object.freeze([
  Object.freeze({ category: '内容', item: '错别字/语病', standard: '通读无错别字、无病句、无歧义' }),
  Object.freeze({ category: '内容', item: '知识点与逻辑', standard: '专业无误，前后不矛盾，结构完整' }),
  Object.freeze({ category: '内容', item: '事实要素', standard: '人名、职务、机构、时间、数据准确' }),
  Object.freeze({ category: '内容', item: '立意与导向', standard: '弘扬主旋律，无商业推广与不当表述' }),
  Object.freeze({ category: '内容', item: '原创性', standard: '真实原创，贴合红十字精神，无抄袭' }),
  Object.freeze({ category: '表述', item: '红十字标识', standard: '白底红十字，未变形、改色或作装饰' }),
  Object.freeze({ category: '表述', item: '红十字精神', standard: '表述为“人道、博爱、奉献”' }),
  Object.freeze({ category: '表述', item: '机构名称', standard: '使用全称或规范简称，不生造' }),
  Object.freeze({ category: '隐私', item: '服务对象照片', standard: '已打码至无法辨认身份' }),
  Object.freeze({ category: '隐私', item: '帮扶对象', standard: '无真实姓名、班级、住址、联系方式' }),
  Object.freeze({ category: '隐私', item: '团队成员照片', standard: '团队成员不打码，已确认出镜同意' }),
  Object.freeze({ category: '图片', item: '清晰度与水印', standard: '实拍为主，清晰无重影、无水印' }),
  Object.freeze({ category: '图片', item: '图片版权', standard: '使用他人图片已取得授权或标明来源' }),
  Object.freeze({ category: '格式', item: '标题', standard: '（栏目分类）| 标题' }),
  Object.freeze({ category: '格式', item: '署名', standard: '文编／美编／责编齐全' }),
  Object.freeze({ category: '格式', item: '结尾', standard: '来源标注、尾图（二维码）到位' }),
  Object.freeze({ category: '排版', item: '段落与空行', standard: '段首不空格、两端对齐；段与段、图与文空行' }),
  Object.freeze({ category: '排版', item: '图片与注释', standard: '图间不空行、图文间空行，注释居中' }),
  Object.freeze({ category: '排版', item: '配色与夜间', standard: '色系相近、总颜色≤3种；夜间模式预览正常' }),
  Object.freeze({ category: '后台', item: '封面', standard: '封面图已完善' }),
  Object.freeze({ category: '发布', item: '发布预览', standard: '回看预览，链接、图片、排版正常' }),
]);

/**
 * 清单必填校验：勾 = 该项「已确认合格」。
 * 通过（approve）时必须逐项确认全部启用检查项；退回时不强制，但缺项清单会随意见回传。
 *
 * @param {Array<string>} checkedIds 本次勾选的模板ID
 * @param {Array<string>} requiredIds 全部启用检查项的模板ID
 * @returns {{ok:boolean, missing:string[]}} ok=false 时 missing 为未确认的模板ID
 */
export function checklistGaps(checkedIds = [], requiredIds = []) {
  const checked = new Set((checkedIds || []).map((id) => String(id)));
  const missing = (requiredIds || []).map((id) => String(id)).filter((id) => !checked.has(id));
  return { ok: missing.length === 0, missing };
}

/* --------------------------------------------------------------------------
   v3 宣传对接人表（按栏目选人）
   -------------------------------------------------------------------------- */

export const LIAISON_TABLE = '宣传对接人表';
export const LIAISON_COLUMNS = ['对接人ID', '姓名', '负责栏目', '角色', '邮箱', '启用'];

export const LIAISON_ROLES = Object.freeze({ liaison: '对接人', reviewer: '审核人' });

/** 通配栏目：一行覆盖全部栏目（可在后台表里改）。 */
export const LIAISON_ANY_CATEGORY = '全部';

/**
 * 对接人/审核人 seed（制度 §4.0 按栏目分工）。
 * 同一人可同时出现在不同栏目的两个角色里——用「负责栏目 + 角色」区分，不按人去重。
 * 邮箱留空时，系统回退到该成员在平台账号表里登记的邮箱。
 */
export const LIAISON_SEED = Object.freeze([
  // —— 对接人（初审）——
  Object.freeze({ name: '王诺', role: 'liaison', categories: ['活动总结', '红会招新'] }),
  Object.freeze({ name: '袁金雨', role: 'liaison', categories: ['人道法言'] }),
  Object.freeze({ name: '刘雨喆', role: 'liaison', categories: ['南小红月报', '小红帮推'] }),
  Object.freeze({ name: '薛徐铸', role: 'liaison', categories: ['心灵慢车', '红会新闻'] }),
  Object.freeze({ name: '刘佳思', role: 'liaison', categories: ['南男女侣', '今日节日'] }),
  Object.freeze({ name: '陈嘉铭', role: 'liaison', categories: ['活动预热', '健康小蓝鲸'] }),
  // —— 审核人（终审）——
  Object.freeze({ name: '王诺', role: 'reviewer', categories: ['活动预热', '南男女侣', '今日节日', '健康小蓝鲸'] }),
  Object.freeze({ name: '袁金雨', role: 'reviewer', categories: ['人道法言', '心灵慢车', '红会新闻'] }),
  Object.freeze({ name: '刘雨喆', role: 'reviewer', categories: ['南小红月报', '小红帮推'] }),
  Object.freeze({ name: '金中宸', role: 'reviewer', categories: ['活动总结', '红会招新'] }),
]);

/* --------------------------------------------------------------------------
   v3 多级审核状态机（第 6/7 项，§4.1）
   一个抽象 + 一份代码，靠「审核层级」字段驱动；不做文字/文创两套实现。
   -------------------------------------------------------------------------- */

/**
 * 投稿种类（决定审核链与落点目录）：
 *   article —— 文字稿件（SUB- 前缀，实名）
 *   design  —— 文创设计（DSN- 前缀，笔名）
 *   brief   —— 小绿书（N3；走 article 同构的 2 级链）
 */
export const SUBMISSION_KINDS = Object.freeze(['article', 'design', 'brief']);

/** 由投稿小类（类别）推断审核链 kind；文创一律 design，小绿书一律 brief。 */
export function submissionKindFor({ category = '', publishForm = '', kind = '' } = {}) {
  if (kind && SUBMISSION_KINDS.includes(kind)) return kind;
  if (normalizePublishForm(publishForm) === '小绿书') return 'brief';
  return category === '文创设计' ? 'design' : 'article';
}

/** 审核状态（宣传投稿表「审核状态」列的合法值）。 */
export const REVIEW_STATUS = Object.freeze({
  pending: '待审核',
  returned: '已退回',
  approved: '已通过',
});

/**
 * 审核轨迹条目（存「审核轨迹」列，JSON 字符串数组）。
 *   { level, name, decision:'approve'|'return', reviewer, role, note, at, round }
 */
export function parseReviewTrail(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 追加一条轨迹并序列化（保留最近 50 条，避免单元格无限膨胀）。 */
export function appendReviewTrail(value, entry) {
  const trail = parseReviewTrail(value);
  trail.push(entry);
  return JSON.stringify(trail.slice(-50));
}

/**
 * 当前层级：从 0 起。0 = 尚未初审。
 * 依据轨迹推导，避免「审核层级」列与轨迹不一致——列只作快照。
 */
export function reviewLevelOf({ reviewLevel = '', reviewTrail = '', status = '' } = {}) {
  if (status === REVIEW_STATUS.returned) {
    // 退回后停在上一级：轨迹里最后一次 approve 的 level 即「待重审」的下一级。
    const trail = parseReviewTrail(reviewTrail);
    return trail.filter((entry) => entry.decision === 'approve').length;
  }
  // 注意：Number('') === 0 且有限，不能用 Number.isFinite 判空——
  // 空列必须回落到轨迹推导，否则新稿件会被误判为「已过 0 级」而丢失轨迹信息。
  const raw = String(reviewLevel ?? '').trim();
  if (raw !== '') {
    const fromColumn = Number(raw);
    if (Number.isFinite(fromColumn) && fromColumn >= 0) return fromColumn;
  }
  return parseReviewTrail(reviewTrail).filter((entry) => entry.decision === 'approve').length;
}

/**
 * 依据「已通过条数」推导当前进度对象：
 *   level      已通过级数（0 = 待初审）
 *   current    当前应审级的定义（无 → 已完成）
 *   total      链总级数
 *   done       是否已走到末级且通过
 */
export function reviewProgressFor(kind, passedCount) {
  const chain = reviewChainFor(kind);
  const passed = Math.max(0, Math.min(Number(passedCount) || 0, chain.length));
  return {
    passed,
    total: chain.length,
    current: passed < chain.length ? chain[passed] : null,
    done: passed >= chain.length,
    chain,
  };
}

/**
 * 存量数据兼容：`审核层级` 空且轨迹空 → 视为「已终审」。
 * 用于排期门禁——v3 之前的历史行不该被新规则拦住。
 */
export function isLegacyReviewed({ reviewLevel = '', reviewTrail = '', status = '' } = {}) {
  const hasLevel = String(reviewLevel ?? '').trim() !== '';
  const hasTrail = parseReviewTrail(reviewTrail).length > 0;
  if (hasLevel || hasTrail) return false;
  // 旧行只有「审核状态=已通过」这一条信息，按终审看待。
  return String(status || '') === REVIEW_STATUS.approved;
}

/** 是否可排期：链走完 + 状态已通过；或命中存量兼容。 */
export function canSchedule({ kind = 'article', reviewLevel = '', reviewTrail = '', status = '' } = {}) {
  if (String(status || '') !== REVIEW_STATUS.approved) return false;
  if (isLegacyReviewed({ reviewLevel, reviewTrail, status })) return true;
  const passed = reviewProgressFor(kind, reviewLevelOf({ reviewLevel, reviewTrail, status })).passed;
  return passed >= finalReviewLevel(kind);
}

/**
 * 一轮意见限制：同一 level 最多退回 1 次。
 * 返回 { allowed, used }；used 为该 level 已用退回次数。
 */
export function canReturnAtLevel(reviewTrail, level) {
  const used = parseReviewTrail(reviewTrail).filter((entry) => entry.level === level && entry.decision === 'return').length;
  return { allowed: used < 1, used };
}

/** 是否允许把「发布形式」视为小绿书链（N3：小绿书走 2 级链）。 */
export function reviewKindForSubmission(submission = {}) {
  return submissionKindFor({
    category: submission.category || submission['类别'],
    publishForm: submission.publishForm || submission['发布形式'],
    kind: submission.kind || submission['稿件类型'],
  });
}


/** 留用状态机：待定 → 留用/弃用（提交者本人可反复改）。 */
export const MEDIA_KEEP_STATUS = Object.freeze({
  pending: '待定',
  keep: '留用',
  drop: '弃用',
  deleted: '已删除',
});

/**
 * 「宣传展示表」：宣传展示板块的数据源（纯展示、无审核流转）。
 * 数据来源双方案：来源列 = 手动导入（scripts/import-showcase.mjs）或
 * 公众号抓取（lib/attachment/showcase-source.js 适配层）。
 */
export const SHOWCASE_TABLE = '宣传展示表';
export const SHOWCASE_COLUMNS = [
  '条目ID', '分组', '标题', '链接', '封面路径', '库ID', '排序', '来源', '创建时间',
];

/** 上传状态机：待上传 → 已上传 →（绑定）；任一状态可转已删除。 */
export const ATTACHMENT_STATUS = Object.freeze({
  pending: '待上传',
  uploaded: '已上传',
  invalid: '校验失败',
  deleted: '已删除',
});

/** 生成与 server.js eventIdentifier 同构的附件编号：ATT-{时间36}-{随机}。 */
export function attachmentIdentifier(prefix = 'ATT') {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * 文件名清洗：取末段、去控制字符、压空白、去首部点号、限长 120 且尽量保扩展名。
 * v2 起由 box.js/api.js 共用（与 oss.js 内实现保持一致语义）。
 */
export function sanitizeFilename(filename) {
  let name = String(filename ?? '').trim();
  const lastSlash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSlash >= 0) name = name.slice(lastSlash + 1);
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '');
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    if (dot > 0 && name.length - dot <= 10) {
      name = `${name.slice(0, 120 - (name.length - dot))}${name.slice(dot)}`;
    } else {
      name = name.slice(0, 120);
    }
  }
  return name;
}

/**
 * 目录名清洗：用于 Box 目录段（活动名/类别/投稿编号）。与文件名不同——
 * 保留中文与空格，去掉文件系统与 Seafile 都不接受的字符与首尾空白。
 */
export function sanitizeDirname(value) {
  let name = String(value ?? '').trim();
  name = name.replace(/[\u0000-\u001f\u007f]/g, '');
  name = name.replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '');
  return name.slice(0, 80);
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value) {
  return String(value ?? '').trim();
}

/** 领域对象 → SeaTable 行（列顺序无关，键与 COLUMNS 一一对应）。 */
export function attachmentRow(attachment) {
  return {
    附件ID: toText(attachment.id),
    投稿ID: toText(attachment.submissionId),
    文件名: toText(attachment.filename),
    MIME类型: toText(attachment.mimeType),
    大小: String(toFiniteNumber(attachment.size)),
    校验和: toText(attachment.checksum).toLowerCase(),
    存储提供商: toText(attachment.provider) || ATTACHMENT_PROVIDER_ALIYUN_OSS,
    Bucket: toText(attachment.bucket),
    对象Key: toText(attachment.objectKey),
    上传状态: toText(attachment.status) || ATTACHMENT_STATUS.pending,
    上传人: toText(attachment.uploader),
    上传时间: toText(attachment.uploadedAt),
    绑定时间: toText(attachment.boundAt),
    中心: toText(attachment.center),
    活动名: toText(attachment.activity),
  };
}

/** SeaTable 行 → 领域对象（旧行缺列时回退到安全默认值）。 */
export function attachmentFromRow(row) {
  const source = row || {};
  return {
    id: toText(source['附件ID']),
    submissionId: toText(source['投稿ID']),
    filename: toText(source['文件名']),
    mimeType: toText(source['MIME类型']),
    size: toFiniteNumber(source['大小']),
    checksum: toText(source['校验和']).toLowerCase(),
    provider: toText(source['存储提供商']) || ATTACHMENT_PROVIDER_ALIYUN_OSS,
    bucket: toText(source['Bucket']),
    objectKey: toText(source['对象Key']),
    status: toText(source['上传状态']) || ATTACHMENT_STATUS.pending,
    uploader: toText(source['上传人']),
    uploadedAt: toText(source['上传时间']),
    boundAt: toText(source['绑定时间']),
    center: toText(source['中心']),
    activity: toText(source['活动名']),
  };
}

/**
 * 「宣传投稿表·附件引用」列的编解码：JSON 数组文本。
 * 历史行为空字符串，解析失败时返回空数组而不是抛错——读侧统一兜底。
 */
export function formatAttachmentRefs(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => toText(id)).filter(Boolean))];
  return JSON.stringify(list);
}

export function parseAttachmentRefs(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  let parsed;
  try { parsed = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  // 读侧只接受字符串 ID：手改表混入的数字等脏值直接丢弃。
  return [...new Set(parsed.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean))];
}

/* --------------------------------------------------------------------------
   影像素材表（影像模块）行映射
   -------------------------------------------------------------------------- */

/** 领域对象 → 影像素材行。 */
export function mediaRow(media) {
  return {
    照片ID: toText(media.id),
    中心: toText(media.center),
    活动名: toText(media.activity),
    摄影师: toText(media.photographer),
    文件名: toText(media.filename),
    MIME类型: toText(media.mimeType),
    大小: String(toFiniteNumber(media.size)),
    校验和: toText(media.checksum).toLowerCase(),
    存储提供商: toText(media.provider) || ATTACHMENT_PROVIDER_NJUBOX,
    // v3：库身份由资料库令牌决定，此列记录逻辑库名（main/picks），便于日后迁移辨识。
    库ID: toText(media.libraryId || media.repoId),
    文件路径: toText(media.path),
    留用状态: toText(media.keepStatus) || MEDIA_KEEP_STATUS.pending,
    上传人: toText(media.uploader),
    上传时间: toText(media.uploadedAt),
    精选状态: toText(media.pickStatus) || MEDIA_PICK_STATUS.none,
    精选申请时间: toText(media.pickRequestedAt),
    精选确认人: toText(media.pickConfirmedBy),
    精选确认时间: toText(media.pickConfirmedAt),
    精选库路径: toText(media.pickPath),
    精选库ID: toText(media.pickLibraryId || media.pickRepoId),
    删除申请状态: toText(media.deleteStatus) || MEDIA_DELETE_STATUS.none,
    删除理由: toText(media.deleteReason),
    删除审核人: toText(media.deleteReviewedBy),
    删除审核时间: toText(media.deleteReviewedAt),
  };
}

/** 影像素材行 → 领域对象（缺列兜底）。 */
export function mediaFromRow(row) {
  const source = row || {};
  return {
    id: toText(source['照片ID']),
    center: toText(source['中心']),
    activity: toText(source['活动名']),
    photographer: toText(source['摄影师']),
    filename: toText(source['文件名']),
    mimeType: toText(source['MIME类型']),
    size: toFiniteNumber(source['大小']),
    checksum: toText(source['校验和']).toLowerCase(),
    provider: toText(source['存储提供商']) || ATTACHMENT_PROVIDER_NJUBOX,
    repoId: toText(source['库ID']),
    path: toText(source['文件路径']),
    keepStatus: toText(source['留用状态']) || MEDIA_KEEP_STATUS.pending,
    uploader: toText(source['上传人']),
    uploadedAt: toText(source['上传时间']),
    pickStatus: toText(source['精选状态']) || MEDIA_PICK_STATUS.none,
    pickRequestedAt: toText(source['精选申请时间']),
    pickConfirmedBy: toText(source['精选确认人']),
    pickConfirmedAt: toText(source['精选确认时间']),
    pickPath: toText(source['精选库路径']),
    pickRepoId: toText(source['精选库ID']),
    deleteStatus: toText(source['删除申请状态']) || MEDIA_DELETE_STATUS.none,
    deleteReason: toText(source['删除理由']),
    deleteReviewedBy: toText(source['删除审核人']),
    deleteReviewedAt: toText(source['删除审核时间']),
  };
}

/** 门户视图：不泄露库 ID 与路径。 */
export function mediaPortalView(media) {
  return {
    id: media.id,
    center: media.center || '',
    activity: media.activity,
    photographer: media.photographer || '',
    filename: media.filename,
    mimeType: media.mimeType,
    size: media.size,
    keepStatus: media.keepStatus,
    pickStatus: media.pickStatus || MEDIA_PICK_STATUS.none,
    deleteStatus: media.deleteStatus || MEDIA_DELETE_STATUS.none,
    uploadedAt: media.uploadedAt || null,
  };
}

/**
 * @deprecated v2 旧式文件夹名：<活动名>_<摄影师>。仅用于历史行展示。
 */
export function mediaFolderName(activity, photographer) {
  const a = sanitizeDirname(activity) || MEDIA_UNNAMED_ACTIVITY;
  const p = sanitizeDirname(photographer);
  return p ? `${a}_${p}` : a;
}

/* --------------------------------------------------------------------------
   v3.1 影像目录构造（按部门的三级结构）
   库根/<部门>/<活动名>/<活动名>-照片/<文件名>      ← 照片
   库根/<部门>/<活动名>/<文件名>                    ← 其他文件（落二级目录）
   -------------------------------------------------------------------------- */

/** 部门目录名（一级）：直接用中心名；缺失时兜底「未归类」。 */
export function mediaDepartmentDir(center) {
  return sanitizeDirname(center) || MEDIA_UNCLASSIFIED_DEPARTMENT;
}

/** 活动目录名（二级）：活动名；缺失时兜底「未命名活动」。 */
export function mediaActivityDir(activity) {
  return sanitizeDirname(activity) || MEDIA_UNNAMED_ACTIVITY;
}

/** 照片子目录名（三级）：<活动名>-照片。 */
export function mediaPhotoDir(activity) {
  return `${mediaActivityDir(activity)}-照片`;
}

/**
 * @deprecated v3.1 起其他文件直接落二级活动目录，不再单建子目录。返回空串表示「无额外子目录层级」。
 */
export function mediaOtherDir() {
  return '';
}

/**
 * 精选库落点（2026-10-28 定案，**与主库刻意不同**）：
 *   /<活动名>/<文件名>
 *
 * 精选库（南大红会精选图片库）从零开始用，只按「活动名」建**一级**文件夹 ——
 * 精选库是给人挑素材的，按活动聚合比复刻主库「部门/活动名/活动名-照片」三级套娃
 * 好找得多。缺活动名时兜底「未命名活动」。目录由 uploadBuffer 内部 ensureDir 自动建。
 */
export function picksStoragePath(activity) {
  const activityDir = mediaActivityDir(activity);
  return { activityDir, dir: `/${activityDir}` };
}

/**
 * v3.1 影像完整落点（相对库根）：
 *   /<部门>/<活动名>/<活动名>-照片/<文件名>   （subdir='photo'，默认）
 *   /<部门>/<活动名>/<文件名>                 （subdir='other'）
 * 返回 { department, activityDir, subdir, dir }。
 */
export function mediaStoragePath(activity, center, { subdir = 'photo' } = {}) {
  const department = mediaDepartmentDir(center);
  const activityDir = mediaActivityDir(activity);
  const base = `/${department}/${activityDir}`;
  return {
    department,
    activityDir,
    subdir: subdir === 'other' ? '' : mediaPhotoDir(activity),
    dir: subdir === 'other' ? base : `${base}/${mediaPhotoDir(activity)}`,
  };
}

/**
 * v3.1 投稿附件落点（相对库根）：/<部门>/<活动名>/<附件ID>
 * 每篇投稿一个以附件ID命名的子目录，与「其他文件」同层但互不覆盖。
 *
 * 2026-10-27 起：文创设计投稿不填部门/活动（前端已移除这两项），
 * 统一落在 /文创设计工作组/<附件ID>；判定依据是「没有部门」——
 * 文字稿件的部门是服务端必填白名单，所以 center 为空只可能是文创。
 * 返回 { department, activityDir, dir }。
 */
export function submissionStoragePath({ center = '', activity = '', attachmentId = '' } = {}) {
  const safeId = sanitizeDirname(attachmentId) || String(attachmentId || '').trim();
  const hasCenter = Boolean(sanitizeDirname(center));
  if (!hasCenter) {
    return { department: DESIGN_WORKGROUP_DIR, activityDir: '', dir: `${DESIGN_WORKGROUP_PATH}/${safeId}` };
  }
  const department = mediaDepartmentDir(center);
  const activityDir = mediaActivityDir(activity);
  return { department, activityDir, dir: `/${department}/${activityDir}/${safeId}` };
}

/* --------------------------------------------------------------------------
   宣传展示表（展示板块）行映射
   -------------------------------------------------------------------------- */

/** 领域对象 → 展示条目行。 */
export function showcaseRow(item) {
  return {
    条目ID: toText(item.id),
    分组: toText(item.group),
    标题: toText(item.title),
    链接: toText(item.link),
    封面路径: toText(item.coverPath),
    库ID: toText(item.repoId),
    排序: String(toFiniteNumber(item.order)),
    来源: toText(item.source) || '手动导入',
    创建时间: toText(item.createdAt),
    // v3 第 14 项：展示分类（3 栏目之一）驱动展示墙分节。
    展示分类: toText(item.showGroup),
  };
}

/** 展示条目行 → 领域对象。 */
export function showcaseFromRow(row) {
  const source = row || {};
  return {
    id: toText(source['条目ID']),
    group: toText(source['分组']),
    showGroup: toText(source['展示分类']),
    title: toText(source['标题']),
    link: toText(source['链接']),
    coverPath: toText(source['封面路径']),
    repoId: toText(source['库ID']),
    order: toFiniteNumber(source['排序']),
    source: toText(source['来源']) || '手动导入',
    createdAt: toText(source['创建时间']),
  };
}
