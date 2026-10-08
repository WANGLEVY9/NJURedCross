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
];

/** 外部存储提供商标识。v2 起主路线为 NJU Box（Seafile），OSS 保留兼容历史行。 */
export const ATTACHMENT_PROVIDER_ALIYUN_OSS = 'aliyun-oss';
export const ATTACHMENT_PROVIDER_NJUBOX = 'njubox';

/**
 * 「影像素材表」：活动照片归档（影像模块）。文件本体存 NJU Box 的
 * /影像素材/<中心>/<活动名>_<摄影师>/ 目录；本表保存元数据与留用状态。
 */
export const MEDIA_TABLE = '影像素材表';
export const MEDIA_COLUMNS = [
  '照片ID', '中心', '活动名', '摄影师', '文件名', 'MIME类型', '大小', '校验和',
  '存储提供商', '库ID', '文件路径', '留用状态', '上传人', '上传时间',
];

/**
 * 归档中心（原「服务队」概念，2026-10 按用户要求改为固定中心分类）。
 * 上传影像时必选其一；禁用值以外的中心名一律拒绝，保证 Box 目录不被脏数据污染。
 */
export const MEDIA_CENTERS = Object.freeze([
  '生命中心', '博爱中心', '综事中心', '苏州分部', '主席团活动',
]);

/** 中心名白名单校验：返回规范化中心名，或空串（非法/缺失）。 */
export function normalizeMediaCenter(value) {
  const name = String(value ?? '').trim();
  return MEDIA_CENTERS.includes(name) ? name : '';
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
    库ID: toText(media.repoId),
    文件路径: toText(media.path),
    留用状态: toText(media.keepStatus) || MEDIA_KEEP_STATUS.pending,
    上传人: toText(media.uploader),
    上传时间: toText(media.uploadedAt),
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
    uploadedAt: media.uploadedAt || null,
  };
}

/** 影像文件夹名：<活动名>_<摄影师>（摄影师缺省时退化为活动名）。 */
export function mediaFolderName(activity, photographer) {
  const a = sanitizeDirname(activity) || '未命名活动';
  const p = sanitizeDirname(photographer);
  return p ? `${a}_${p}` : a;
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
  };
}

/** 展示条目行 → 领域对象。 */
export function showcaseFromRow(row) {
  const source = row || {};
  return {
    id: toText(source['条目ID']),
    group: toText(source['分组']),
    title: toText(source['标题']),
    link: toText(source['链接']),
    coverPath: toText(source['封面路径']),
    repoId: toText(source['库ID']),
    order: toFiniteNumber(source['排序']),
    source: toText(source['来源']) || '手动导入',
    createdAt: toText(source['创建时间']),
  };
}
