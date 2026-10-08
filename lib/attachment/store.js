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

/** 外部存储提供商标识；预留多供应商扩展（如 njubox）。 */
export const ATTACHMENT_PROVIDER_ALIYUN_OSS = 'aliyun-oss';

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
