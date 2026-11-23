import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import canvasPackage from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildEvidenceDocx } from './docx-writer.js';
import { extractDocxImages, sniffImage } from './docx-media.js';
import { materialExtension } from '../../public/app/shared/reimbursement-files.js';

const { createCanvas } = canvasPackage;
const IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp']);
const RENDER_SCALE = 2;
const MAX_RENDER_PAGES = 60;
const MAX_WIDTH = 2400;
const MAX_BYTES = 4 * 1024 * 1024;
const STD_FONTS = fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/');
const CMAPS = fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url)).replace(/\\/g, '/');

const money = (cents) => (Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) : '');

/** Normalise one picture into a size Word can lay out, keeping text legible. */
async function prepareImage(bytes, extension, caption) {
  let data = Buffer.from(bytes), kind = extension === 'jpeg' ? 'jpeg' : extension;
  if (!['png', 'jpeg'].includes(kind)) { data = await sharp(data).png().toBuffer(); kind = 'png'; }
  let meta;
  try { meta = await sharp(data).metadata(); } catch { return null; }
  if (!meta.width || !meta.height) return null;
  if (meta.width > MAX_WIDTH || data.length > MAX_BYTES) {
    const resized = await sharp(data).resize({ width: Math.min(meta.width, MAX_WIDTH), withoutEnlargement: true })
      .jpeg({ quality: 88, chromaSubsampling: '4:4:4' }).toBuffer();
    const resizedMeta = await sharp(resized).metadata();
    if (resizedMeta.width && resizedMeta.height) { data = resized; kind = 'jpeg'; meta = resizedMeta; }
  }
  return { bytes: data, extension: kind, width: meta.width, height: meta.height, caption };
}

async function pdfImages(bytes, captionPrefix) {
  const images = [];
  let task;
  try {
    task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false,
      standardFontDataUrl: STD_FONTS, cMapUrl: CMAPS, cMapPacked: true, verbosity: 0 });
    const document = await task.promise;
    const pages = Math.min(document.numPages, MAX_RENDER_PAGES);
    for (let index = 1; index <= pages; index++) {
      const page = await document.getPage(index);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      if (viewport.width * viewport.height > 40_000_000) continue;
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      const png = canvas.toBuffer('image/png');
      const prepared = await prepareImage(png, 'png', `${captionPrefix}${document.numPages > 1 ? ` · 第 ${index} 页` : ''}`);
      if (prepared) images.push(prepared);
    }
  } catch { /* unreadable PDF keeps no picture; the caller still links the original */ }
  finally { if (task) await task.destroy(); }
  return images;
}

/** Collect the pictures of one uploaded material, regardless of the container the applicant used. */
export async function materialImages(file) {
  const extension = materialExtension(file.name);
  const bytes = Buffer.from(file.bytes || []);
  if (!bytes.length) return [];
  if (IMAGE_FORMATS.has(extension)) {
    const prepared = await prepareImage(bytes, extension === 'jpg' ? 'jpeg' : extension, file.name);
    return prepared ? [prepared] : [];
  }
  if (extension === 'pdf') return pdfImages(bytes, file.name);
  if (extension === 'docx') {
    const { images } = extractDocxImages(bytes);
    const result = [];
    for (const [index, image] of images.entries()) {
      const prepared = await prepareImage(image.bytes, image.extension, `${file.name}${images.length > 1 ? ` · 图 ${index + 1}` : ''}`);
      if (prepared) result.push(prepared);
    }
    return result;
  }
  return [];
}

const TYPE_ORDER = ['订单截图', '付款截图', '订单和付款截图', '领取单', '行程单', '快递单', '快递起终点截图', '人员名单', '住宿清单', '会议邀请函', '高铁二等座价格证明', '其他'];

/**
 * Build the single Word packet for one reimbursement: every supporting material, grouped by expense
 * item and then by material type, with invoices intentionally excluded (they stay separate PDFs).
 */
export async function renderSupportingPacket({ request, files }) {
  const supporting = (files || []).filter(file => file.kind === 'supporting');
  if (!supporting.length) return null;
  const items = request?.expenseItems || [];
  const groups = [];
  const order = (file) => {
    const index = items.findIndex(item => item.id === file.expenseItemId);
    return index < 0 ? items.length : index;
  };
  const buckets = new Map();
  for (const file of supporting) {
    const key = `${order(file)}|${file.expenseItemId || ''}|${file.materialType || '其他'}`;
    if (!buckets.has(key)) buckets.set(key, { fileKey: order(file), file, files: [] });
    buckets.get(key).files.push(file);
  }
  const sorted = [...buckets.values()].sort((a, b) => a.fileKey - b.fileKey
    || TYPE_ORDER.indexOf(a.file.materialType) - TYPE_ORDER.indexOf(b.file.materialType));
  for (const bucket of sorted) {
    const images = [];
    for (const file of bucket.files) images.push(...await materialImages(file));
    if (!images.length) continue;
    const index = items.findIndex(item => item.id === bucket.file.expenseItemId);
    const item = index >= 0 ? items[index] : null;
    const heading = item ? `第 ${index + 1} 项 · ${item.label || '未命名项目'}${item.amountCents ? `（${money(item.amountCents)} 元）` : ''}`
      : '整份申请';
    const type = bucket.file.materialType || '补充材料';
    groups.push({ heading, note: `${type} · 共 ${images.length} 张`, images });
  }
  if (!groups.length) return null;
  const meta = [];
  if (request?.name) meta.push({ label: '申请人', value: request.name });
  if (request?.code) meta.push({ label: '申请编号', value: request.code });
  if (request?.activityName || request?.activityNameSnapshot) meta.push({ label: '关联活动', value: request.activityName || request.activityNameSnapshot });
  if (request?.expenseDate) meta.push({ label: '活动日期', value: request.expenseDate });
  if (Number.isSafeInteger(request?.amountCents)) meta.push({ label: '报销金额', value: `${money(request.amountCents)} 元` });
  return buildEvidenceDocx({
    title: '报销补充材料',
    subtitle: request?.purpose || '',
    meta,
    groups,
    footer: '本文件由志愿平台根据申请人上传的原件自动生成，图片为等比例副本；如与原件不一致，以平台存档原件为准。',
  });
}
