import { degrees, PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';
import { UPLOAD_LIMITS, MB } from '../../public/app/shared/reimbursement-limits.js';
import { extractInvoiceFields, pdfTextBoxes, invoiceBuyer } from './invoice-fields.js';
import { materialExtension, MATERIAL_UPLOADS } from '../../public/app/shared/reimbursement-files.js';
import { validateWord } from './supporting-files.js';
import { extractDocxImages } from './docx-media.js';

export const PDF_LIMITS = Object.freeze({ files: UPLOAD_LIMITS.files, fileBytes: UPLOAD_LIMITS.fileMB * MB, totalBytes: UPLOAD_LIMITS.totalMB * MB, pages: UPLOAD_LIMITS.pages });
export function pdfFailure(message) { return Object.assign(new Error(message), { statusCode: 400, code: 'reimbursement_pdf_invalid' }); }

/** Only an explicit buyer-name field can produce a name hint; a university name elsewhere is insufficient. */
export function buyerHint(text) {
  const normalized = String(text).normalize('NFKC');
  const section = normalized.split(/购买方(?:信息)?|购方/)[1]?.split(/销售方|销方/)[0]?.slice(0, 180) || '';
  const buyer = section.match(/(?:名\s*称)\s*[:：]\s*([^\n\r]{2,80})/);
  if (!buyer) return { state: 'unknown', name: '', message: '未定位到购买方名称，请人工核对。' };
  const name = buyer[1].split(/(?:纳税人|统一社会|识别号|税号|销售方|地址|电话)/)[0].replace(/\s+/g, '').trim();
  if (!name || name.length > 40) return { state: 'unknown', name: '', message: '购买方字段不明确，请人工核对。' };
  return { state: name === '南京大学' ? 'matched' : 'different', name,
    message: name === '南京大学' ? '文本提示：购买方名称为南京大学，仍需核对原票。' : `文本提示：购买方名称为“${name}”，请核对原票。` };
}

function pageText(items) {
  const lines = new Map();
  for (const item of items) {
    if (!item.str || !item.transform) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!lines.has(y)) lines.set(y, []);
    lines.get(y).push({ x: item.transform[4], text: item.str });
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0])
    .map(([, line]) => line.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')).join('\n');
}

const ORDER_TYPES = new Set(['订单截图']);
const PAYMENT_TYPES = new Set(['付款截图', '共用付款账单']);
const LOGISTICS_TYPES = new Set(['物流截图', '快递单', '快递起终点截图']);
const typed = (file, types) => file.kind === 'supporting' && types.has(file.materialType);
const combinedEvidence = file => file.kind === 'supporting' && file.materialType === '订单和付款截图';
const PAGE_WIDTH = 595, PAGE_HEIGHT = 842, PAGE_MARGIN = 20, COLUMN_GAP = 16;
const COLUMNS_PER_PAGE = 3;
const sheet = panels => {
  const rows = [];
  for (let index = 0; index < panels.length; index += COLUMNS_PER_PAGE) rows.push(panels.slice(index, index + COLUMNS_PER_PAGE));
  return rows;
};

/** Page order for the merged evidence PDF: invoices first, then one page per order/payment pair,
 * then everything else in upload order. Order and payment screenshots share a page side by side,
 * mirroring the paper packets finance expects. No caption, page number or label is drawn anywhere. */
function pageSlots(entries) {
  const invoices = [], evidence = new Map(), rest = [];
  const ids = new Set(entries.map(entry => entry.file.expenseItemId).filter(Boolean));
  for (const entry of entries) {
    const { file } = entry;
    if (file.kind === 'invoice') { invoices.push([entry]); continue; }
    const type = typed(file, ORDER_TYPES) ? 'orders' : typed(file, PAYMENT_TYPES) ? 'payments'
      : combinedEvidence(file) ? 'combined' : file.kind === 'supporting' && file.materialType === '行程单' ? 'itineraries'
      : typed(file, LOGISTICS_TYPES) ? 'logistics' : null;
    if (!type) { rest.push([entry]); continue; }
    const key = file.expenseItemId || (ids.size === 1 ? ids.values().next().value : '');
    if (!evidence.has(key)) evidence.set(key, { orders: [], payments: [], combined: [], itineraries: [], logistics: [] });
    evidence.get(key)[type].push(entry);
  }
  const itineraries = [], paired = [], standalone = [], taxi = [];
  for (const group of evidence.values()) {
    itineraries.push(...group.itineraries.map(entry => [entry]));
    const target = group.itineraries.length ? taxi : paired;
    for (let index = 0; index < Math.max(group.orders.length, group.payments.length); index++) {
      const order = group.orders[index], payment = group.payments[index];
      if (order && payment) target.push(...sheet([order, ...group.logistics, payment]));
      else standalone.push([order || payment]);
    }
    target.push(...group.combined.map(entry => [entry]));
    group.logistics.length = 0;
  }
  return [...invoices, ...itineraries, ...paired, ...standalone, ...rest, ...taxi];
}

function panelBounds(width, height, left, availableWidth, pageHeight, maxScale = Infinity) {
  const scale = Math.min(maxScale, availableWidth / width, (pageHeight - 2 * PAGE_MARGIN) / height);
  const w = width * scale, h = height * scale;
  return { x: left + (availableWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h };
}

async function drawPanel(merged, page, visual, left, width) {
  if (visual.image) {
    const { image } = visual;
    page.drawImage(image, panelBounds(image.width, image.height, left, width, page.getHeight(), 1));
    return;
  }
  const { pdfPage } = visual;
  if (!pdfPage.node.Contents()) return;
  const { x, y, width: sourceWidth, height: sourceHeight } = pdfPage.getCropBox();
  if (!(sourceWidth > 0 && sourceHeight > 0)) throw pdfFailure('截图 PDF 的页面尺寸无效。');
  const embedded = await merged.embedPage(pdfPage, { left: x, bottom: y, right: x + sourceWidth, top: y + sourceHeight });
  const angle = (pdfPage.getRotation().angle % 360 + 360) % 360;
  const sideways = angle === 90 || angle === 270;
  const bounds = panelBounds(sideways ? sourceHeight : sourceWidth, sideways ? sourceWidth : sourceHeight, left, width, page.getHeight());
  page.drawPage(embedded, { x: bounds.x + (angle >= 180 ? bounds.width : 0),
    y: bounds.y + (angle === 90 || angle === 180 ? bounds.height : 0),
    width: sideways ? bounds.height : bounds.width, height: sideways ? bounds.width : bounds.height, rotate: degrees(-angle) });
}

async function inspectPages(bytes, count) {
  const checks = [];
  let task;
  try {
    task = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false,
      cMapUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url)).replace(/\\/g, '/'), cMapPacked: true,
      standardFontDataUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/'), verbosity: 0 });
    const parsed = await task.promise;
    for (let index = 1; index <= count; index++) {
      const page = await parsed.getPage(index);
      const items = (await page.getTextContent()).items, text = pageText(items);
      const invoice = extractInvoiceFields(pdfTextBoxes(items, page.getViewport({ scale: 1, rotation: 0 })), { text });
      checks.push({ page: index, ...invoiceBuyer(invoice), invoice, textAvailable: Boolean(text.trim()), seal: 'manual',
        sealMessage: '尚未进行本地图像检查，可识别疑似红章后人工确认。' });
    }
  } catch {
    for (let index = checks.length + 1; index <= count; index++) checks.push({ page: index, state: 'unknown', name: '',
      textAvailable: false, message: '无法提取文本，请人工查看原票。', seal: 'manual', sealMessage: '红章需人工确认。' });
  } finally { if (task) await task.destroy(); }
  return checks;
}

/** Validates one upload and resolves it to a drawable form; nothing is written to the merged document yet. */
async function prepareEntry(file) {
  const bytes = new Uint8Array(file.bytes);
  const extension = materialExtension(file.name);
  if (!bytes.length || bytes.length > PDF_LIMITS.fileBytes) throw pdfFailure(`单个文件不超过 ${UPLOAD_LIMITS.fileMB} MB。`);
  if (file.kind === 'supporting' && extension !== 'pdf') {
    if (!MATERIAL_UPLOADS.supportingFormats.includes(extension)) throw pdfFailure('补充材料支持 PDF、Word、JPG 和 PNG。');
    if (['doc', 'docx'].includes(extension)) {
      validateWord(bytes, extension);
      // The original Word file is retained, and its pictures can be laid out with other evidence.
      const pictures = extension === 'docx'
        ? extractDocxImages(bytes).images.filter(image => ['png', 'jpeg'].includes(image.extension)) : [];
      return { form: 'word', pictures };
    }
    const data = Buffer.from(bytes);
    if (extension === 'png') {
      if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        || !data.readUInt32BE(16) || !data.readUInt32BE(20) || data.readUInt32BE(16) * data.readUInt32BE(20) > 40_000_000) throw pdfFailure('图片无法读取或超过 4000 万像素，请上传有效的 JPG、PNG。');
    } else if (data.length < 3 || !data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) throw pdfFailure('图片无法读取或超过 4000 万像素，请上传有效的 JPG、PNG。');
    return { form: 'image', bytes, extension };
  }
  if (extension !== 'pdf'
    || !Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw pdfFailure(`文件必须为有效 PDF，单个文件不超过 ${UPLOAD_LIMITS.fileMB} MB。`);
  const doc = await loadPdf(bytes, file);
  const count = doc.getPageCount();
  if (!count || count > PDF_LIMITS.pages) throw pdfFailure('合并材料须为 1 至 100 页。');
  // Form values are material evidence. Avoid copying ambiguous widgets without their field tree.
  if (doc.getForm().getFields().length) throw pdfFailure('材料含可填写表单，请先导出为已确认内容的普通 PDF。原文件无需修改。');
  return { form: 'pdf', doc, count, checks: await inspectPages(bytes, count) };
}

/** Some producers put the first indirect object on a PDF comment line without a line break.
 * pdf-lib then skips that object at its xref offset and silently yields a page with no content.
 * Replace the trailing object header with spaces and a newline, preserving every byte offset. */
function normalizePdfHeader(bytes) {
  const marker = Buffer.from('%%'), firstLine = Buffer.from(bytes.subarray(0, 256)).indexOf(10) + 1;
  const comment = firstLine ? Buffer.from(bytes.subarray(firstLine, 1024)).indexOf(marker) : -1;
  if (comment < 0) return bytes;
  const start = firstLine + comment, end = Buffer.from(bytes.subarray(start, start + 1024)).indexOf(10);
  if (end < 0) return bytes;
  const line = bytes.subarray(start, start + end);
  const text = Buffer.from(line).toString('latin1');
  const object = text.match(/(\d+)\s+(\d+)\s+obj\b/);
  if (!object || object.index === undefined || !/^%%\S+\s+/.test(text.slice(0, object.index))) return bytes;
  const header = object.index;
  const normalized = new Uint8Array(bytes);
  normalized.fill(32, start + 1, start + header);
  normalized[start] = 37;
  normalized[start + header - 1] = 10;
  return normalized;
}

async function loadPdf(bytes, file) {
  for (const candidate of [normalizePdfHeader(bytes), bytes]) {
    try {
      const doc = await PDFDocument.load(candidate, { updateMetadata: false });
      if (!doc.getPageCount()) continue;
      if (candidate === bytes) return doc;
      const contents = doc.getPages().every(page => page.node.Contents());
      const original = await PDFDocument.load(bytes, { updateMetadata: false });
      if (contents || !original.getPages().every(page => page.node.Contents())) return doc;
    } catch { /* Try the original bytes next, or report a readable failure. */ }
  }
  throw pdfFailure(`材料包含无法读取或加密的 PDF：${String(file.name || '').slice(0, 80)}，请换成可直接打开的 PDF。`);
}

/** Returns a derivative and source manifest. Original bytes are retained by the caller, never overwritten. */
export async function processPdfs(files) {
  if (!Array.isArray(files) || !files.length || files.length > PDF_LIMITS.files) throw pdfFailure('请上传 1 至 10 份材料。');
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > PDF_LIMITS.totalBytes) throw pdfFailure(`材料总大小不能超过 ${UPLOAD_LIMITS.totalMB} MB。`);
  const prepared = [];
  for (const file of files) prepared.push({ file, index: prepared.length, ...(await prepareEntry(file)) });
  const merged = await PDFDocument.create(), info = new Map();
  let pageCount = 0;
  async function embed(entry) {
    try {
      const { bytes } = entry;
      const image = entry.extension === 'png' ? await merged.embedPng(bytes)
        : await merged.embedJpg(bytes.byteOffset ? new Uint8Array(bytes) : bytes);
      if (image.width * image.height > 40_000_000 || image.width <= 0 || image.height <= 0) throw new Error();
      return image;
    } catch { throw pdfFailure('图片无法读取或超过 4000 万像素，请上传有效的 JPG、PNG。'); }
  }
  function addEvidencePage(size) {
    if (pageCount >= PDF_LIMITS.pages) throw pdfFailure('合并材料不能超过 100 页。');
    pageCount++;
    return merged.addPage(size);
  }
  async function visuals(entry) {
    if (entry.form === 'pdf') return entry.doc.getPages().map(pdfPage => ({ pdfPage }));
    if (entry.form === 'image') return [{ image: await embed(entry) }];
    const pictures = [];
    for (const [index, picture] of entry.pictures.entries()) {
      try { pictures.push({ image: await embed(picture), picturePage: index + 1 }); } catch { /* Keep the original Word file available. */ }
    }
    return pictures;
  }
  function recordVisuals(entry, startPage, pages, pictures, combined = false) {
    info.set(entry.index, { pages, startPage: pages ? startPage : null, endPage: pages ? startPage + pages - 1 : null,
      checks: combined ? [] : entry.checks || [], ...(combined ? { composedEvidence: true } : {}),
      ...(entry.form === 'word' ? { preview: pages ? 'word-images' : 'original-only',
        ...(!combined && pages ? { picturePages: pictures.map(picture => picture.picturePage) } : {}) }
        : entry.form === 'image' ? { preview: 'image' } : {}) });
  }
  async function drawEvidencePage(panels, landscape = false) {
    const page = addEvidencePage(landscape ? [PAGE_HEIGHT, PAGE_WIDTH] : [PAGE_WIDTH, PAGE_HEIGHT]);
    const available = page.getWidth() - 2 * PAGE_MARGIN;
    const width = (available - COLUMN_GAP * (panels.length - 1)) / panels.length;
    for (const [index, panel] of panels.entries()) {
      if (panel) await drawPanel(merged, page, panel, PAGE_MARGIN + index * (width + COLUMN_GAP), width);
    }
  }
  for (const slot of pageSlots(prepared)) {
    const [entry] = slot;
    const combined = combinedEvidence(entry.file) && (entry.form === 'word' || entry.form === 'pdf' && entry.count > 1);
    if (slot.length > 1 || combined) {
      const columns = [];
      for (const source of slot) columns.push(await visuals(source));
      const startPage = pageCount + 1;
      if (slot.length > 1) {
        const placed = Math.max(...columns.map(column => column.length));
        for (let index = 0; index < placed; index++) for (const panels of sheet(columns.map(column => column[Math.floor(index * column.length / placed)] || column.at(-1)).filter(Boolean))) await drawEvidencePage(panels);
        slot.forEach((source, index) => recordVisuals(source, startPage, columns[index].length, columns[index]));
      } else {
        const pictures = columns[0];
        for (let index = 0; index < pictures.length; index += COLUMNS_PER_PAGE) await drawEvidencePage(pictures.slice(index, index + COLUMNS_PER_PAGE));
        recordVisuals(entry, startPage, pageCount - startPage + 1, pictures, true);
      }
      continue;
    }
    const startPage = pageCount + 1;
    if (entry.form !== 'pdf') {
      const pictures = await visuals(entry);
      if (!pictures.length) { info.set(entry.index, { pages: 0, startPage: null, endPage: null, checks: [], preview: 'original-only' }); continue; }
      for (const picture of pictures) await drawEvidencePage([picture]);
      recordVisuals(entry, startPage, pictures.length, pictures);
      continue;
    }
    if (pageCount + entry.count > PDF_LIMITS.pages) throw pdfFailure('合并材料须为 1 至 100 页。');
    if (entry.file.kind === 'invoice' || entry.file.kind === 'supporting') {
      for (const pdfPage of entry.doc.getPages()) await drawEvidencePage([{ pdfPage }], entry.file.kind === 'invoice');
    } else {
      for (const page of await merged.copyPages(entry.doc, entry.doc.getPageIndices())) merged.addPage(page);
      pageCount += entry.count;
    }
    info.set(entry.index, { pages: entry.count, startPage, endPage: pageCount, checks: entry.checks });
  }
  const output = pageCount ? Buffer.from(await merged.save()) : Buffer.alloc(0);
  return { merged: output, sources: prepared.map(entry => ({ name: entry.file.name, ...info.get(entry.index) })), pageCount };
}
