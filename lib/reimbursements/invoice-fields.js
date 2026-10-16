/** Field values are evidence hints, never approval decisions. Identifiers stay strings. */
import { INVOICE_FIELD_LABELS } from '../../public/app/shared/reimbursement-files.js';
export { INVOICE_FIELD_LABELS };
const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');

export function pdfTextBoxes(items, viewport) {
  return items.filter(item => item.str?.trim() && item.transform && item.height > 0).map(item => {
    const [x1, y1] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    const [x2, y2] = viewport.convertToViewportPoint(item.transform[4] + item.width, item.transform[5] + item.height);
    return { text: item.str, x: Math.min(x1, x2) / viewport.width, y: Math.min(y1, y2) / viewport.height,
      width: Math.abs(x2 - x1) / viewport.width, height: Math.abs(y2 - y1) / viewport.height, confidence: null };
  });
}

export function ocrTextBoxes(tsv, width, height) {
  return String(tsv || '').split('\n').slice(1).flatMap(line => {
    const values = line.split('\t');
    if (values[0] !== '5' || !values[11]?.trim()) return [];
    return [{ text: values.slice(11).join('\t'), x: Number(values[6]) / width, y: Number(values[7]) / height,
      width: Number(values[8]) / width, height: Number(values[9]) / height, confidence: Number(values[10]) }];
  }).filter(box => [box.x, box.y, box.width, box.height, box.confidence].every(Number.isFinite));
}

function linesFor(boxes) {
  const lines = [];
  for (const box of boxes.filter(box => !(box.height > .06 && (box.partyHint || /购买方|销售方/.test(compact(box.text)))))
    .sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2)) {
    const center = box.y + box.height / 2;
    let line = lines.find(value => Math.abs(value.center - center) < Math.max(value.height, box.height) * .65);
    if (!line) { line = { center, height: box.height, boxes: [] }; lines.push(line); }
    line.boxes.push(box); line.height = Math.max(line.height, box.height);
  }
  return lines.map(line => ({ ...line, boxes: line.boxes.sort((a, b) => a.x - b.x) }));
}

function partyAnchors(boxes) {
  const anchors = [];
  for (const box of boxes) {
    const text = compact(box.text);
    if (box.partyHint && ['buyer', 'seller'].includes(box.partyHint)) anchors.push({ ...box, party: box.partyHint });
    if (/购买方|购方|销售方|销方/.test(text)) anchors.push({ ...box, party: /购买方|购方/.test(text) ? 'buyer' : 'seller' });
    if (!/^[购销]$/.test(text)) continue;
    const column = boxes.filter(value => Math.abs(value.x - box.x) < .008 && value.y >= box.y - .003
      && value.y < box.y + Math.max(box.height * 7, .08) && compact(value.text).length === 1).sort((a, b) => a.y - b.y);
    const joined = column.map(value => compact(value.text)).join('');
    if (/^(购买方|销售方)/.test(joined)) anchors.push({ ...box, party: text === '购' ? 'buyer' : 'seller',
      height: column.at(-1).y + column.at(-1).height - box.y });
  }
  return anchors;
}

/** Crop only the narrow party-label columns found beside an aligned pair of name fields. */
export function partyLabelRegions(boxes) {
  const lines = linesFor(boxes), regions = [];
  for (const line of lines) {
    const joined = compact(line.boxes.map(box => box.text).join(''));
    if ((joined.match(/名称[:：]/g) || []).length !== 2) continue;
    const starts = line.boxes.filter(box => compact(box.text) === '名' || /^名称(?:[:：]|$)/.test(compact(box.text)));
    if (starts.length !== 2 || starts[1].x - starts[0].x < .25) continue;
    for (const start of starts) {
      const bottom = lines.find(value => value.center > line.center + .03 && value.center < line.center + .16
        && /统一社会信用|纳税人/.test(compact(value.boxes.map(box => box.text).join(' '))))?.center;
      if (!bottom) continue;
      regions.push({ x: Math.max(0, start.x - .043), y: Math.max(0, line.center - .035),
        width: .04, height: bottom - line.center + .065 });
    }
  }
  return regions.slice(0, 2);
}

function readLabel(line, pattern, minX = 0, maxX = 1) {
  const row = line.boxes.filter(box => box.x >= minX - .005 && box.x < maxX - .005);
  const text = row.map(box => box.text).join(' ');
  const match = text.match(pattern);
  if (!match) return null;
  const remainder = text.slice(match.index + match[0].length).trim();
  let offset = 0;
  const used = row.filter(box => { const end = offset + box.text.length; offset = end + 1; return end > match.index + match[0].length; });
  return { text: remainder, evidence: text.slice(0, 250), confidence: used.some(box => box.confidence !== null)
    ? Math.min(...used.filter(box => box.confidence !== null).map(box => box.confidence)) : null };
}

function dateValue(text) {
  const match = compact(text).match(/(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
  if (!match) return '';
  const value = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : '';
}

export function extractInvoiceFields(boxes, { method = 'pdf-text', text = '', confidence = null } = {}) {
  const candidates = Object.fromEntries(Object.keys(INVOICE_FIELD_LABELS).map(key => [key, []]));
  const lines = linesFor(boxes), anchors = partyAnchors(boxes);
  function add(key, read, value) {
    if (!value || !read) return;
    candidates[key].push({ value, evidence: read.evidence, method, confidence: read.confidence });
  }
  for (const anchor of anchors) {
    const right = anchors.filter(value => value.party !== anchor.party && value.x > anchor.x + .08
      && Math.abs(value.y - anchor.y) < .18).sort((a, b) => a.x - b.x)[0]?.x || 1;
    const nextSection = anchors.filter(value => value.y > anchor.y + .04 && Math.abs(value.x - anchor.x) < .1)
      .sort((a, b) => a.y - b.y)[0]?.y || 1;
    const bottom = Math.min(nextSection, anchor.y + (anchor.height > .05 ? anchor.height + .015 : .18));
    for (const line of lines.filter(value => value.center >= anchor.y - .025 && value.center < bottom)) {
      const read = readLabel(line, /名\s*称\s*[:：]?/, anchor.x, right);
      if (read) {
        const value = compact(read.text.split(/统一社会|纳税人|识别号|税号|地址|电话|销售方|购买方/)[0]);
        if (value && value.length <= 80 && !/[:：]/.test(value)) add(`${anchor.party}Name`, read, value);
      }
      if (anchor.party === 'buyer') {
        const tax = readLabel(line, /(?:纳\s*税\s*人\s*识\s*别\s*号|统一\s*社会\s*信用\s*代码|税\s*号)\s*[:：]?/, anchor.x, right);
        const value = compact(tax?.text || '').replace(/^[/／]?纳税人识别号[:：]?/, '').match(/^([A-Z0-9]{15,20})(?![A-Z0-9])/i)?.[1];
        add('buyerTaxId', tax, value?.toUpperCase());
      }
    }
  }
  for (const line of lines) {
    const number = readLabel(line, /发\s*票\s*(?:号\s*码|号)\s*[:：]?/);
    add('invoiceNumber', number, compact(number?.text).match(/^(\d{8,20})(?!\d)/)?.[1]);
    const date = readLabel(line, method === 'local-ocr' && candidates.invoiceNumber.length ? /开\s*\S\s*日\s*期\s*[:：]?/ : /开\s*票\s*日\s*期\s*[:：]?/);
    add('invoiceDate', date, dateValue(date?.text));
    const joined = line.boxes.map(box => box.text).join(' ');
    if (/价\s*税\s*合\s*计/.test(joined)) {
      const amount = readLabel(line, /小\s*写\s*[）)]?/) || readLabel(line, /价\s*税\s*合\s*计\s*[:：]?/);
      // Use the explicit tax-inclusive total, never an item amount or tax subtotal.
      const value = compact(amount?.text).match(/[¥￥]([0-9]+(?:\.[0-9]{1,2})?)(?![\d.])/)
        || compact(amount?.text).match(/^(\d+\.\d{2})(?![\d.])/)
        || compact(amount?.text).match(/[^\d.]([0-9]+\.[0-9]{2})$/);
      if (value) {
        const [whole, fraction = ''] = value[1].split('.');
        const numericBoxes = line.boxes.filter(box => /\d/.test(box.text) && box.confidence !== null);
        if (numericBoxes.length) amount.confidence = Math.min(...numericBoxes.map(box => box.confidence));
        if (whole.length <= 9) add('totalAmount', amount, `${whole}.${fraction.padEnd(2, '0')}`);
      }
    }
  }
  // Horizontal text-only OCR can still expose explicit parties. Never infer a buyer from a stray name.
  if (!anchors.length && text) {
    const normalized = String(text).normalize('NFKC');
    for (const [party, marker, end] of [['buyer', /购买方(?:信息)?|购方/, /销售方|销方/], ['seller', /销售方(?:信息)?|销方/, /价税合计|项目名称/]]) {
      const section = normalized.split(marker)[1]?.split(end)[0];
      const match = section?.match(/名\s*称\s*[:：]\s*([^\n\r]{2,80})/);
      if (match) add(`${party}Name`, { evidence: match[0], confidence: method === 'local-ocr' ? confidence ?? 0 : null }, compact(match[1].split(/纳税人|统一社会|识别号|地址|电话/)[0]));
    }
  }
  const fields = Object.fromEntries(Object.entries(candidates).map(([key, values]) => {
    const distinct = [...new Set(values.map(value => value.value))];
    const best = values.find(value => value.confidence === null || value.confidence >= 65) || values[0];
    const state = distinct.length > 1 ? 'conflict' : !best || (best.confidence !== null && best.confidence < 65) ? 'unknown' : 'extracted';
    return [key, { label: INVOICE_FIELD_LABELS[key], state, value: state === 'extracted' ? best.value : '',
      method, confidence: best?.confidence ?? null, evidence: best?.evidence || '',
      ...(distinct.length > 1 ? { candidates: distinct } : {}) }];
  }));
  return { fields, complete: Object.values(fields).every(field => field.state === 'extracted'), method };
}

export function invoiceBuyer(invoice) {
  const field = invoice.fields.buyerName;
  if (field.state !== 'extracted') return { state: 'unknown', name: '', method: field.method,
    message: field.state === 'conflict' ? '存在多个购买方名称，请逐张核对原票。' : '购买方字段未能可靠提取，请人工核对。' };
  return { state: field.value === '南京大学' ? 'matched' : 'different', name: field.value, method: field.method,
    confidence: field.confidence, message: `已从购买方字段提取“${field.value}”，请以原票为准。` };
}
