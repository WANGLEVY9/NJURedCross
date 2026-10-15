export const MATERIAL_KINDS = Object.freeze({ invoice: '发票', supporting: '补充材料', legacy: '原材料' });
export const MATERIAL_UPLOADS = Object.freeze({ version: 3, kinds: ['invoice', 'supporting'], automaticNames: true,
  supportingFormats: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'] });
/** 补充材料的文件类型；命名规则「报销人-条目-金额-文件类型」中的「文件类型」。 */
export const SUPPORTING_MATERIAL_TYPES = Object.freeze(['订单截图', '付款截图', '订单和付款截图', '领取单', '行程单', '住宿清单', '其他']);
export const INVOICE_FIELD_LABELS = Object.freeze({ buyerName: '购买方名称', buyerTaxId: '购买方识别号',
  sellerName: '开票方名称', invoiceNumber: '发票号码', invoiceDate: '开票日期', totalAmount: '实际金额（价税合计）' });
export function materialExtension(name) { return String(name || '').match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || ''; }
export function materialContentType(name) {
  return ({ pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[materialExtension(name)] || 'application/octet-stream';
}
const safePart = (value, fallback) => String(value || '').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_')
  .replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 45) || fallback;

/** Changes the download name only; originals retain their bytes and source names.
    All classified materials follow「报销人-条目-金额-文件类型」. */
export function materialFilename({ name, category, label, kind, index, originalName = '', materialType = '', amount = '' }) {
  const extension = materialExtension(originalName);
  const ext = MATERIAL_UPLOADS.supportingFormats.includes(extension) ? extension : 'pdf';
  if (kind === 'supporting') {
    const ordinal = `-${String(index + 1).padStart(2, '0')}`;
    return `${safePart(name, '报销人')}-${safePart(label, '报销材料')}-${safePart(amount, '金额')}-${safePart(materialType, '补充材料')}${ordinal}.${ext}`;
  }
  if (kind === 'invoice') return `${safePart(name, '报销人')}-${safePart(label, '报销材料')}-${safePart(amount, '金额')}-发票.pdf`;
  const ordinal = kind === 'invoice' ? '' : `-${String(index + 1).padStart(2, '0')}`;
  return `${safePart(name, '报销人')}-${safePart(category, '其他')}-${safePart(label, '报销材料')}-${MATERIAL_KINDS[kind] || '补充材料'}${ordinal}.${ext}`;
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

export function mergedFilename({ name, label, amount = '' }) {
  return `${safePart(name, '报销人')}-${safePart(label, '报销材料')}-${safePart(amount, '金额')}-合并材料.pdf`;
}

/** Alias older generated download names using reliable current request metadata, without editing originals. */
export function requestMaterialFilename(request, file, index, files) {
  const expense = request.expenseItems?.find(item => item.id === file.expenseItemId);
  if (!['invoice', 'supporting'].includes(file.kind) || file.kind === 'invoice' && !expense
    || !Number.isSafeInteger(expense?.amountCents ?? request.amountCents)) return currentMaterialName(file.name, file.kind);
  return materialFilename({ name: request.name, label: expense?.label || request.purpose, kind: file.kind,
    amount: ((expense?.amountCents ?? request.amountCents) / 100).toFixed(2), materialType: file.materialType || '',
    originalName: file.originalName || file.name,
    index: file.kind === 'supporting' ? files.slice(0, index).filter(item => item.kind === 'supporting').length : index });
}

export function invoicePages(bundle) {
  if (!bundle.sources?.length) return Array.from({ length: bundle.pageCount }, (_, index) => index + 1);
  return bundle.sources.filter(source => source.kind !== 'supporting' && source.startPage > 0)
    .flatMap(source => Array.from({ length: source.endPage - source.startPage + 1 }, (_, index) => source.startPage + index));
}
