import {createHash} from 'node:crypto';

/**
 * 允许单附件、带强类型约束的邮件类型（历史两类凭证邮件）。
 * 这两类是对外凭证，附件类型与大小必须精确匹配，不能放宽。
 */
const STRICT_KINDS = Object.freeze({
  'workflow-hours': {
    suffix: '.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: 1 * 1024 * 1024,
  },
  'reimbursement-initial': {
    suffix: '.pdf',
    contentType: 'application/pdf',
    bytes: 10 * 1024 * 1024,
  },
});

/** 宣传审核待办汇总：允许 0..N 个投稿附件。 */
const DIGEST_PREFIX = 'outreach.digest.';

/**
 * 汇总邮件附件上限，与 `lib/attachment/digest.js` 的 DIGEST_ATTACHMENT_LIMITS 对齐。
 * 两处都拦一次：装填层决定「附哪些」，这里决定「能不能出网」。
 */
const DIGEST_LIMITS = Object.freeze({
  totalBytes: 20 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  maxFiles: 30,
});

/**
 * 允许原样透传给邮件客户端的 MIME。
 *
 * 其余一律降级为 application/octet-stream：投稿附件由学生上传，声明什么 MIME
 * 都有可能；把 text/html 之类的类型原样塞进邮件，等于允许投稿人往审核人邮箱里
 * 放一段可渲染的网页。
 */
const SAFE_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/zip',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const safeContentType = (value) => {
  const type = String(value || '').trim().toLowerCase();
  return SAFE_TYPES.has(type) ? type : 'application/octet-stream';
};

/** 文件名只允许「无路径、无换行、不超长」；正文里的序号前缀已由 digest 层加好。 */
function safeFilename(value) {
  const name = String(value || '');
  if (!name || name.length > 160 || /[\r\n\\/]/.test(name)) return '';
  return name;
}

function digestAttachments(items) {
  if (items.length > DIGEST_LIMITS.maxFiles) throw new Error('邮件附件无效');
  let total = 0;
  return items.map(item => {
    const filename = safeFilename(item?.filename);
    if (!filename) throw new Error('邮件附件无效');
    if (!Buffer.isBuffer(item.content) || !item.content.length || item.content.length > DIGEST_LIMITS.fileBytes) {
      throw new Error('邮件附件无效');
    }
    total += item.content.length;
    if (total > DIGEST_LIMITS.totalBytes) throw new Error('邮件附件无效');
    const allowed = ['filename', 'content', 'contentType', 'attachmentId'];
    if (Object.keys(item).some(key => !allowed.includes(key))) throw new Error('邮件附件无效');
    const attachmentId = typeof item.attachmentId === 'string' ? item.attachmentId.trim() : '';
    return {
      filename,
      content: Buffer.from(item.content),
      contentType: safeContentType(item.contentType),
      ...(attachmentId ? {attachmentId} : {}),
    };
  });
}

export function mailAttachments(message){
 const kind = String(message.kind || '');
 if(message.attachments===undefined){
   if(kind==='workflow-hours')throw new Error('最终时长邮件必须包含附件');
   return [];
 }
 const items=message.attachments;
 if(!Array.isArray(items)||!items.length)throw new Error('邮件附件无效');
 if(kind.startsWith(DIGEST_PREFIX))return digestAttachments(items);
 const strict=STRICT_KINDS[kind];
 if(!strict||items.length!==1)throw new Error('邮件附件无效');
 const pdf=kind==='reimbursement-initial';
 return items.map(item=>{
  if(!item||typeof item.filename!=='string'||!item.filename.endsWith(strict.suffix)||item.filename.length>160||/[\r\n\\/]/.test(item.filename)||!Buffer.isBuffer(item.content)||!item.content.length||item.content.length>strict.bytes||item.contentType!==strict.contentType||Object.keys(item).some(key=>!['filename','content','contentType'].includes(key)))throw new Error('邮件附件无效');
  if(pdf&&item.content.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error('邮件附件无效');
  return {filename:item.filename,content:Buffer.from(item.content),contentType:item.contentType};
 });
}
export const attachmentIntent=items=>items.map(item=>({filename:item.filename,contentType:item.contentType,sha256:createHash('sha256').update(item.content).digest('hex')}));

/**
 * 重试队列里保存的附件**引用**（不是内容）。
 *
 * 加密载荷有 80KB 明文上限，塞不下任何真实附件；把附件 ID 存进去，补发时重新
 * 从云盘取一次即可。取不到就降级为无附件发送，并在正文追加重发说明。
 */
export function attachmentRefs(items){
 const list=Array.isArray(items)?items:[];
 return list
  .filter(item=>item&&typeof item.attachmentId==='string'&&item.attachmentId.trim())
  .map(item=>({attachmentId:item.attachmentId.trim(),filename:String(item.filename||''),contentType:String(item.contentType||'')}));
}
