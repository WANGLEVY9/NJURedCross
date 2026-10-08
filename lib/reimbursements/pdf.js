import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';
import { UPLOAD_LIMITS, MB } from '../../public/app/shared/reimbursement-limits.js';

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

/** Returns a derivative and source manifest. Original bytes are retained by the caller, never overwritten. */
export async function processPdfs(files) {
  if (!Array.isArray(files) || !files.length || files.length > PDF_LIMITS.files) throw pdfFailure('请上传 1 至 10 个 PDF。');
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > PDF_LIMITS.totalBytes) throw pdfFailure(`材料总大小不能超过 ${UPLOAD_LIMITS.totalMB} MB。`);
  const merged = await PDFDocument.create();
  const sources = [];
  let pageCount = 0;
  for (const file of files) {
    const bytes = new Uint8Array(file.bytes);
    if (!/\.pdf$/i.test(file.name) || !bytes.length || bytes.length > PDF_LIMITS.fileBytes
      || !Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) throw pdfFailure(`文件必须为有效 PDF，单个文件不超过 ${UPLOAD_LIMITS.fileMB} MB。`);
    let doc;
    try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch {
      throw pdfFailure('材料包含无法读取或加密的 PDF，请换成可直接打开的 PDF。');
    }
    const count = doc.getPageCount();
    if (!count || pageCount + count > PDF_LIMITS.pages) throw pdfFailure('合并材料须为 1 至 100 页。');
    // Form values are material evidence. Avoid copying ambiguous widgets without their field tree.
    if (doc.getForm().getFields().length) throw pdfFailure('材料含可填写表单，请先导出为已确认内容的普通 PDF。原文件无需修改。');
    const checks = [];
    let task;
    try {
      task = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false,
        cMapUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url)).replace(/\\/g, '/'), cMapPacked: true,
        standardFontDataUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replace(/\\/g, '/'), verbosity: 0 });
      const parsed = await task.promise;
      for (let index = 1; index <= count; index++) {
        const page = await parsed.getPage(index);
        const text = pageText((await page.getTextContent()).items);
        checks.push({ page: index, ...buyerHint(text), textAvailable: Boolean(text.trim()), seal: 'manual',
          sealMessage: '尚未进行本地图像检查，可识别疑似红章后人工确认。' });
      }
    } catch {
      for (let index = checks.length + 1; index <= count; index++) checks.push({ page: index, state: 'unknown', name: '',
        textAvailable: false, message: '无法提取文本，请人工查看原票。', seal: 'manual', sealMessage: '红章需人工确认。' });
    } finally { if (task) await task.destroy(); }
    for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
    sources.push({ name: file.name, pages: count, startPage: pageCount + 1, endPage: pageCount + count, checks });
    pageCount += count;
  }
  const output = Buffer.from(await merged.save());
  return { merged: output, sources, pageCount };
}
