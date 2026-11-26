/** Upload size and type policy shared by the browser and Node attachment routes. */

export const MB = 1024 * 1024;

/** A single file going straight to NJU Box never passes through the Node process. */
export const DIRECT_UPLOAD_MAX_BYTES = 500 * MB;
/**
 * Start direct upload above 20MB so the current nginx 25M body limit never
 * rejects a legitimate file before the browser gets a Box upload link.
 */
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 20 * MB;
/**
 * Relay fallback goes through Node and the reverse proxy. 128MiB fits the
 * standard nginx body allowance and the 1 GiB instance can buffer it once.
 */
export const RELAY_UPLOAD_MAX_BYTES = 128 * MB;

export const SPREADSHEET_MIME_PATTERN = /^(application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|application\/vnd\.ms-excel|application\/wps-office\.xlsx?|text\/csv|application\/csv)$/;

/**
 * Active content and executables stay blocked even when an extension looks
 * harmless. Everything else is matched by MIME first, then by a narrow
 * extension fallback for browsers that only send application/octet-stream.
 */
const BLOCKED_MIME = /^(?:text\/html|application\/(?:javascript|x-javascript|x-msdownload|x-msi|exe|java-archive|x-shockwave-flash)|image\/svg\+xml)/;

const DOCUMENT_MIME = /^(?:application\/(?:msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.openxmlformats-officedocument\.presentationml\.presentation|vnd\.ms-powerpoint|vnd\.oasisfilenameisnotdefined|rtf|x-rtf))$/;
const ARCHIVE_MIME = /^application\/(?:zip|x-7z-compressed|x-rar-compressed|x-tar|gzip|x-gzip)$/;
const DESIGN_MIME = /^(?:application\/postscript|image\/vnd\.adobe\.photoshop|application\/vnd\.adobe\.illustrator)$/;

/** maxSize is per file; labels are user-facing and must stay in sync in both runtimes. */
export const FILE_RULES = Object.freeze([
  { kind: 'image', match: /^image\//, maxSize: 100 * MB, label: '图片（100MB）' },
  { kind: 'video', match: /^video\//, maxSize: 500 * MB, label: '视频（500MB）' },
  { kind: 'audio', match: /^audio\//, maxSize: 200 * MB, label: '音频（200MB）' },
  { kind: 'pdf', match: /^application\/pdf$/, maxSize: 200 * MB, label: 'PDF（200MB）' },
  { kind: 'spreadsheet', match: SPREADSHEET_MIME_PATTERN, maxSize: 200 * MB, label: '表格（200MB）' },
  { kind: 'document', match: DOCUMENT_MIME, maxSize: 200 * MB, label: '文档（200MB）' },
  { kind: 'archive', match: ARCHIVE_MIME, maxSize: 500 * MB, label: '压缩包（500MB）' },
  { kind: 'design', match: DESIGN_MIME, maxSize: 500 * MB, label: '设计源文件（500MB）' },
]);

/** Extensions accepted when the browser reports no useful MIME type. */
const EXTENSION_RULES = Object.freeze([
  { match: /\.(?:jpe?g|png|webp|gif|bmp|heic|heif|tiff?|avif)$/i, kind: 'image' },
  { match: /\.(?:mp4|mov|m4v|webm|mkv|avi)$/i, kind: 'video' },
  { match: /\.(?:mp3|wav|m4a|aac|flac|ogg)$/i, kind: 'audio' },
  { match: /\.pdf$/i, kind: 'pdf' },
  { match: /\.(?:doc|docx|ppt|pptx|odt|odp|rtf|txt|md)$/i, kind: 'document' },
  { match: /\.(?:xls|xlsx|csv)$/i, kind: 'spreadsheet' },
  { match: /\.(?:zip|7z|rar|tar|gz|tgz)$/i, kind: 'archive' },
  { match: /\.(?:psd|ai|eps|ps)$/i, kind: 'design' },
]);

const UNKNOWN_MIME = /^(?:|text\/plain|application\/octet-stream)$/;

export function fileRuleFor(mimeType, filename = '') {
  const value = String(mimeType || '').trim().toLowerCase();
  if (BLOCKED_MIME.test(value)) return null;
  const direct = FILE_RULES.find((rule) => rule.match.test(value));
  if (direct) return direct;
  if (!UNKNOWN_MIME.test(value)) return null;
  const name = String(filename || '');
  const hit = EXTENSION_RULES.find((rule) => rule.match.test(name));
  return hit ? FILE_RULES.find((rule) => rule.kind === hit.kind) || null : null;
}

export const ALLOWED_UPLOAD_HINT = '图片（100MB）/ 视频（500MB）/ 音频（200MB）/ PDF（200MB）/ Word、表格与文本（200MB）/ 压缩包与设计源文件（500MB）';

export function uploadTimeoutFor(bytes) {
  const size = Number(bytes) || 0;
  // 10MB 以下给 5 分钟，之后每 10MB 增加 1 分钟，500MB 封顶 30 分钟。
  return Math.min(30 * 60 * 1000, Math.max(5 * 60 * 1000,
    5 * 60 * 1000 + Math.max(0, size - 10 * MB) / (10 * MB) * 60_000));
}
