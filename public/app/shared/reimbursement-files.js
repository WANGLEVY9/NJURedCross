export const MATERIAL_KINDS = Object.freeze({ invoice: '发票', supporting: '补充材料', legacy: '原材料' });
export const MATERIAL_UPLOADS = Object.freeze({ version: 3, kinds: ['invoice', 'supporting'], automaticNames: true,
  supportingFormats: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'] });
export const INVOICE_FIELD_LABELS = Object.freeze({ buyerName: '购买方名称', buyerTaxId: '购买方识别号',
  sellerName: '开票方名称', invoiceNumber: '发票号码', invoiceDate: '开票日期', totalAmount: '实际金额（价税合计）' });
export function materialExtension(name) { return String(name || '').match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || ''; }
export function materialContentType(name) {
  return ({ pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[materialExtension(name)] || 'application/octet-stream';
}
const safePart = (value, fallback) => String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
  .replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 45) || fallback;

/** Changes the download name only. The uploaded original bytes and original name are retained. */
export function materialFilename({ name, category, label, kind, index, originalName = '' }) {
  const extension = materialExtension(originalName);
  const ordinal = kind === 'invoice' ? '' : `-${String(index + 1).padStart(2, '0')}`;
  return `${safePart(name, '报销人')}-${safePart(category, '其他')}-${safePart(label, '报销材料')}-${MATERIAL_KINDS[kind] || '补充材料'}${ordinal}.${MATERIAL_UPLOADS.supportingFormats.includes(extension) ? extension : 'pdf'}`;
}

/** Present older generated names consistently without rewriting stored originals or records. */
export function currentMaterialName(name, kind, index) {
  if (kind === 'invoice') return name.replace(/-发票-\d+\.pdf$/i, '-发票.pdf');
  if (kind === 'supporting') {
    const current = name.replace(/-其他材料-(\d+)\./, '-补充材料-$1.');
    return Number.isInteger(index) && index >= 0
      ? current.replace(/-补充材料-\d+(\.[a-z0-9]+)$/i, `-补充材料-${String(index + 1).padStart(2, '0')}$1`) : current;
  }
  return name;
}

export function mergedFilename({ name, category, label }) {
  return `${safePart(name, '报销人')}-${safePart(category, '其他')}-${safePart(label, '报销材料')}-合并材料.pdf`;
}

export function invoicePages(bundle) {
  if (!bundle.sources?.length) return Array.from({ length: bundle.pageCount }, (_, index) => index + 1);
  return bundle.sources.filter(source => source.kind !== 'supporting' && source.startPage > 0)
    .flatMap(source => Array.from({ length: source.endPage - source.startPage + 1 }, (_, index) => source.startPage + index));
}
