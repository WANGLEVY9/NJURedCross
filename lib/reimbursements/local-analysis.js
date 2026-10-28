import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extractInvoiceFields, pdfTextBoxes, ocrTextBoxes, invoiceBuyer, partyLabelRegions } from './invoice-fields.js';
import { redSealCandidates } from './seal-candidates.js';
import { PDFDocument } from 'pdf-lib';
import { materialExtension } from '../../public/app/shared/reimbursement-files.js';
import { extractSupportingFields } from './supporting-fields.js';

const require = createRequire(import.meta.url);
const localPath = resource => fileURLToPath(new URL(resource, import.meta.url)).replace(/\\/g, '/');

function horizontalPartyLabel(crop) {
  const pixels = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height), rows = [];
  for (let y = 0; y < crop.height; y++) {
    let min = crop.width, max = -1;
    for (let x = 0; x < crop.width; x++) if (pixels.data[(y * crop.width + x) * 4] < 180) { min = Math.min(min, x); max = x; }
    if (max - min < 2) continue;
    const previous = rows.at(-1);
    if (previous && y - previous.bottom <= Math.max(4, crop.width * .06)) {
      previous.bottom = y; previous.left = Math.min(previous.left, min); previous.right = Math.max(previous.right, max);
    } else rows.push({ top: y, bottom: y, left: min, right: max });
  }
  const glyphs = rows.filter(row => row.bottom - row.top > crop.width * .1);
  if (glyphs.length < 3 || glyphs.length > 6) return null;
  const cell = Math.max(...glyphs.map(row => Math.max(row.bottom - row.top, row.right - row.left))) + 16;
  const line = createCanvas(cell * glyphs.length, cell), context = line.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, line.width, line.height);
  glyphs.forEach((row, index) => {
    const width = row.right - row.left + 1, height = row.bottom - row.top + 1;
    context.drawImage(crop, row.left, row.top, width, height, index * cell + (cell - width) / 2, (cell - height) / 2, width, height);
  });
  return line;
}

/** Called in an isolated child process; images, models and WASM all remain local. */
export async function analyzeLocalPage({ bytes, pageNumber, materialKind, materialType, originalName }) {
  const supporting = materialKind === 'supporting';
  const extension = materialExtension(originalName);
  if (supporting && ['png', 'jpg', 'jpeg'].includes(extension)) {
    const pdf = await PDFDocument.create();
    // IPC Buffers can point inside a larger backing store; the JPEG reader needs a zero-offset view.
    const imageBytes = new Uint8Array(bytes);
    const image = extension === 'png' ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
    pdf.addPage([image.width, image.height]).drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    bytes = await pdf.save();
  }
  const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0,
    cMapUrl: localPath('../../node_modules/pdfjs-dist/cmaps/'), cMapPacked: true,
    standardFontDataUrl: localPath('../../node_modules/pdfjs-dist/standard_fonts/') });
  let worker;
  try {
    const doc = await task.promise;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new Error('页码不正确');
    const page = await doc.getPage(pageNumber), base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height), Math.sqrt(4_000_000 / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const seal = redSealCandidates(pixels);
    const textItems = (await page.getTextContent()).items;
    const text = textItems.map(item => item.str || '').join(' ');
    const invoice = extractInvoiceFields(pdfTextBoxes(textItems, page.getViewport({ scale: 1, rotation: 0 })), { text });
    const result = { page: pageNumber, method: 'local-text-and-image', seal, invoice, buyer: invoiceBuyer(invoice), textSnippet: text.slice(0, 6000) };
    if (supporting) {
      result.supporting = extractSupportingFields(pdfTextBoxes(textItems, base));
      const needed = materialType === '订单截图' ? ['productName'] : materialType === '付款截图' ? ['paidAmount'] : ['productName', 'paidAmount'];
      if (needed.every(key => result.supporting[key].state === 'extracted')) return result;
    }
    if (!supporting && invoice.complete) return result;
    const langPath = dirname(require.resolve('@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz'));
    worker = await createWorker('chi_sim', 1, { langPath, cacheMethod: 'none', logging: false });
    await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1', user_defined_dpi: '180' });
    // Remove only long straight red table rules. Red field labels remain available to OCR.
    const ink = new Uint8Array(canvas.width * canvas.height);
    for (let index = 0; index < ink.length; index++) {
      const offset = index * 4, r = pixels.data[offset];
      ink[index] = r > 100 && r - pixels.data[offset + 1] > 35 && r - pixels.data[offset + 2] > 30 ? 1 : 0;
    }
    const erase = index => { const offset = index * 4; pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 255; };
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width;) {
      if (!ink[y * canvas.width + x]) { x++; continue; }
      const start = x; while (x < canvas.width && ink[y * canvas.width + x]) x++;
      if (x - start > canvas.width * .2) for (let column = start; column < x; column++) erase(y * canvas.width + column);
    }
    for (let x = 0; x < canvas.width; x++) for (let y = 0; y < canvas.height;) {
      if (!ink[y * canvas.width + x]) { y++; continue; }
      const start = y; while (y < canvas.height && ink[y * canvas.width + x]) y++;
      if (y - start > canvas.height * .2) for (let row = start; row < y; row++) erase(row * canvas.width + x);
    }
    // Red labels contain field evidence too. Keep their contrast instead of erasing all red ink.
    for (let index = 0; index < pixels.data.length; index += 4) {
      const r = pixels.data[index], g = pixels.data[index + 1], b = pixels.data[index + 2];
      const gray = Math.round(.299 * r + .587 * g + .114 * b);
      pixels.data[index] = gray; pixels.data[index + 1] = gray; pixels.data[index + 2] = gray;
    }
    context.putImageData(pixels, 0, 0);
    const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { text: true, tsv: true });
    const boxes = ocrTextBoxes(data.tsv, canvas.width, canvas.height);
    if (supporting) {
      const ocr = extractSupportingFields(boxes, { method: 'local-ocr' });
      const needed = materialType === '订单截图' ? ['productName'] : materialType === '付款截图' ? ['paidAmount'] : ['productName', 'paidAmount'];
      if (needed.some(key => ocr[key].state === 'unknown')) {
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        const retried = (await worker.recognize(canvas.toBuffer('image/png'), {}, { text: true, tsv: true })).data;
        const fields = extractSupportingFields(ocrTextBoxes(retried.tsv, canvas.width, canvas.height), { method: 'local-ocr' });
        for (const key of ['productName', 'paidAmount']) {
          if (ocr[key].state === 'unknown' || fields[key].state === 'conflict') ocr[key] = fields[key];
          else if (fields[key].state === 'extracted' && fields[key].value !== ocr[key].value)
            ocr[key] = { ...fields[key], state: 'conflict', value: '', evidence: '两次图像识别的字段不一致，请核对原件。' };
        }
      }
      for (const key of ['productName', 'paidAmount']) {
        if (ocr[key].state === 'conflict' || result.supporting[key].state === 'unknown') result.supporting[key] = ocr[key];
        else if (ocr[key].state === 'extracted' && ocr[key].value !== result.supporting[key].value)
          result.supporting[key] = { ...ocr[key], state: 'conflict', value: '', evidence: 'PDF 文字层与图像识别不一致，请核对原件。' };
      }
      result.textSnippet = (text.trim() ? `${text}\n\nOCR：\n${data.text}` : data.text).slice(0, 6000);
      result.method = 'local-ocr-and-image';
      return result;
    }
    // Vertical party labels often disappear in whole-page OCR. Read those small columns separately.
    if (invoice.fields.buyerName.state === 'unknown' || invoice.fields.sellerName.state === 'unknown') {
      for (const proposed of partyLabelRegions(boxes)) {
        const marker = boxes.find(box => /^[购销]$/.test(box.text) && box.confidence >= 65 && box.x >= proposed.x
          && box.x < proposed.x + proposed.width && box.y >= proposed.y && box.y < proposed.y + proposed.height);
        // Focus on the glyph column to keep residual table borders out of the label crop.
        const region = marker ? { ...proposed, x: Math.max(proposed.x, marker.x - .006),
          width: Math.min(proposed.width, marker.width + .012) } : proposed;
        const crop = createCanvas(Math.ceil(region.width * canvas.width * 2), Math.ceil(region.height * canvas.height * 2));
        crop.getContext('2d').drawImage(canvas, region.x * canvas.width, region.y * canvas.height,
          region.width * canvas.width, region.height * canvas.height, 0, 0, crop.width, crop.height);
        await worker.setParameters({ tessedit_pageseg_mode: '6' });
        let { data: label } = await worker.recognize(crop.toBuffer('image/png'), {}, { text: true, tsv: true });
        if (!/购买方|销售方/.test(label.text.replace(/\s+/g, '')) || label.confidence < 65) {
          const horizontal = horizontalPartyLabel(crop);
          if (horizontal) {
            await worker.setParameters({ tessedit_pageseg_mode: '7' });
            const retried = (await worker.recognize(horizontal.toBuffer('image/png'), {}, { text: true, tsv: true })).data;
            if (/购买方|销售方/.test(retried.text.replace(/\s+/g, '')) && retried.confidence >= 65) label = retried;
          }
        }
        const value = label.text.replace(/\s+/g, '');
        const words = ocrTextBoxes(label.tsv, crop.width, crop.height);
        const party = /^购买/.test(value) ? 'buyer' : /^销售/.test(value) ? 'seller' : null;
        const wholeLabelWords = boxes.filter(box => box.x >= region.x && box.x < region.x + region.width
          && box.y >= region.y && box.y < region.y + region.height);
        const prefixConfidence = party ? Math.min(...[...(party === 'buyer' ? '购买' : '销售')].map(character => Math.max(0,
          ...[...words, ...wholeLabelWords].filter(word => word.text.includes(character)).map(word => word.confidence)))) : 0;
        // Only the explicit 购买/销售 prefix determines the role; an unclear suffix is not invented.
        if (party && prefixConfidence >= 65) boxes.push({ ...region, text: value, partyHint: party, confidence: prefixConfidence });
      }
    }
    const ocr = extractInvoiceFields(boxes, { method: 'local-ocr', text: data.text, confidence: data.confidence });
    if (ocr.fields.buyerTaxId.state === 'unknown' && ocr.fields.buyerTaxId.evidence) {
      const buyer = boxes.find(box => box.partyHint === 'buyer');
      const right = buyer ? boxes.filter(box => box.partyHint === 'seller' && box.x > buyer.x).sort((a, b) => a.x - b.x)[0]?.x || 1 : 0;
      const identifiers = buyer ? boxes.filter(box => box.x > buyer.x && box.x < right && box.y >= buyer.y
        && box.y < buyer.y + buyer.height + .025 && /^[:：]?[A-Z0-9]{15,20}$/.test(box.text.replace(/\s+/g, ''))) : [];
      if (identifiers.length === 1) {
        const box = identifiers[0], left = Math.max(0, box.x * canvas.width - 4), top = Math.max(0, box.y * canvas.height - 6);
        const width = Math.min(canvas.width - left, box.width * canvas.width + 8), height = Math.min(canvas.height - top, box.height * canvas.height + 12);
        const crop = createCanvas(Math.ceil(width * 2), Math.ceil(height * 2));
        crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
        await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
        const { data: identifier } = await worker.recognize(crop.toBuffer('image/png'));
        const value = identifier.text.replace(/\s+/g, '');
        if (/^[A-Z0-9]{15,20}$/.test(value) && identifier.confidence >= 65) ocr.fields.buyerTaxId = {
          ...ocr.fields.buyerTaxId, state: 'extracted', value, confidence: identifier.confidence,
          evidence: `${ocr.fields.buyerTaxId.evidence}；识别号区域复核 OCR：${value}` };
      }
    }
    if (ocr.fields.totalAmount.state === 'unknown' && ocr.fields.totalAmount.evidence) {
      const totalLabel = boxes.find(box => /价/.test(box.text) && boxes.some(value => /合计/.test(value.text) && Math.abs(value.y - box.y) < .03));
      if (totalLabel) {
        const digits = boxes.filter(box => /\d/.test(box.text) && box.x > .5 && Math.abs(box.y - totalLabel.y) < .025);
        if (digits.length) {
          const left = Math.max(0, Math.min(...digits.map(box => box.x)) * canvas.width - 6);
          const top = Math.max(0, Math.min(...digits.map(box => box.y)) * canvas.height - 6);
          const width = Math.min(canvas.width - left, Math.max(...digits.map(box => box.x + box.width)) * canvas.width - left + 6);
          const height = Math.min(canvas.height - top, Math.max(...digits.map(box => box.y + box.height)) * canvas.height - top + 6);
          const crop = createCanvas(Math.ceil(width * 2), Math.ceil(height * 2));
          crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
          await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.' });
          const { data: amount } = await worker.recognize(crop.toBuffer('image/png'));
          const value = amount.text.replace(/\s+/g, '');
          if (/^(?:0|[1-9]\d{0,8})\.\d{2}$/.test(value) && amount.confidence >= 65) ocr.fields.totalAmount = {
            ...ocr.fields.totalAmount, state: 'extracted', value, confidence: amount.confidence,
            evidence: `${ocr.fields.totalAmount.evidence}；金额区域复核 OCR：${value}` };
        }
      }
    }
    for (const [key, field] of Object.entries(ocr.fields)) {
      // A conflict is not a missing value. Keep it visible instead of replacing it with another guess.
      if (result.invoice.fields[key].state === 'unknown' && (field.state !== 'unknown' || field.evidence)) result.invoice.fields[key] = field;
    }
    result.invoice.complete = Object.values(result.invoice.fields).every(field => field.state === 'extracted');
    result.invoice.method = textItems.some(item => item.str?.trim()) ? 'pdf-text-and-local-ocr' : 'local-ocr';
    result.buyer = invoiceBuyer(result.invoice);
    result.textSnippet = (text.trim() ? `${text}\n\nOCR：\n${data.text}` : data.text).slice(0, 6000);
    result.method = 'local-ocr-and-image';
    return result;
  } finally { if (worker) await worker.terminate(); await task.destroy(); }
}
