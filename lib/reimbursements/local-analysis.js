import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buyerHint } from './pdf.js';
import { redSealCandidates } from './seal-candidates.js';

const require = createRequire(import.meta.url);
const localPath = resource => fileURLToPath(new URL(resource, import.meta.url)).replace(/\\/g, '/');

/** Called in an isolated child process; images, models and WASM all remain local. */
export async function analyzeLocalPage({ bytes, pageNumber, previousCheck }) {
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
    const result = { page: pageNumber, method: 'local-text-and-image', seal, buyer: {
      state: previousCheck?.state || 'unknown', name: previousCheck?.name || '',
      message: previousCheck?.message || '购买方名称待人工核对。', method: 'pdf-text' } };
    if (previousCheck?.textAvailable && previousCheck.state !== 'unknown') return result;
    const langPath = dirname(require.resolve('@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz'));
    worker = await createWorker('chi_sim', 1, { langPath, cacheMethod: 'none', logging: false });
    await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1', user_defined_dpi: '180' });
    // Remove saturated red ink for text recognition; the original and the seal detector use the color image.
    for (let index = 0; index < pixels.data.length; index += 4) {
      const r = pixels.data[index], g = pixels.data[index + 1], b = pixels.data[index + 2];
      const red = r > 110 && r - g > 45 && r - b > 40;
      const gray = red ? 255 : Math.round(.299 * r + .587 * g + .114 * b);
      pixels.data[index] = gray; pixels.data[index + 1] = gray; pixels.data[index + 2] = gray;
    }
    context.putImageData(pixels, 0, 0);
    const { data } = await worker.recognize(canvas.toBuffer('image/png'));
    const hint = buyerHint(data.text);
    const confidence = Number.isFinite(data.confidence) ? Math.round(data.confidence) : 0;
    const confident = confidence >= 65;
    result.buyer = { ...hint, method: 'local-ocr', confidence,
      ...(confident ? { message: hint.message.replace('文本提示', 'OCR 提示') }
        : { state: 'unknown', message: 'OCR 识别质量较低，购买方名称需人工核对。' }) };
    result.textSnippet = data.text.slice(0, 1600);
    result.method = 'local-ocr-and-image';
    return result;
  } finally { if (worker) await worker.terminate(); await task.destroy(); }
}
