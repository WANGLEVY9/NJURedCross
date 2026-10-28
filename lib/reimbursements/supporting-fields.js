const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '');
const amountValue = value => {
  const raw = compact(value).replace(/^[-−]/, '').replace(/^([¥￥])[-−]/, '$1');
  if (!/^[¥￥]?(?:\d{1,9}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?(?:元|人民币)?$/.test(raw)) return '';
  const match = raw.replace(/,/g, '').match(/^[¥￥]?(\d{1,9})(?:\.(\d{1,2}))?(?:元|人民币)?$/);
  return match ? `${match[1]}.${(match[2] || '').padEnd(2, '0')}` : '';
};

/** Explicit labels only: list prices, discounts and order numbers cannot become payments. */
export function extractSupportingFields(boxes, { method = 'pdf-text' } = {}) {
  const lines = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let line = lines.find(line => Math.abs(line.y - box.y) < Math.max(line.height, box.height) * .65);
    if (!line) { line = { y: box.y, height: box.height, boxes: [] }; lines.push(line); }
    line.boxes.push(box);
  }
  const rows = lines.map(line => ({ text: compact(line.boxes.sort((a, b) => a.x - b.x).map(box => box.text).join(' ')),
    confidence: line.boxes.some(box => Number.isFinite(box.confidence))
      ? Math.min(...line.boxes.filter(box => Number.isFinite(box.confidence)).map(box => box.confidence)) : null }));
  function field(label, parse) {
    const values = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], match = row.text.match(label);
      if (!match) continue;
      const rest = row.text.slice(match.index + match[0].length).replace(/^[:：]/, '');
      const next = !rest && rows[index + 1];
      const value = parse(rest || next?.text || '');
      if (value) values.push({ value, evidence: `${row.text}${next ? ` ${next.text}` : ''}`.slice(0, 300),
        confidence: next && Number.isFinite(next.confidence) ? Math.min(row.confidence ?? 100, next.confidence) : row.confidence });
    }
    const reliable = values.filter(value => value.confidence === null || value.confidence >= 65);
    const distinct = [...new Set(reliable.map(value => value.value))];
    const state = distinct.length > 1 ? 'conflict' : reliable.length ? 'extracted' : 'unknown';
    return { state, value: state === 'extracted' ? distinct[0] : '', method,
      evidence: (reliable[0] || values[0])?.evidence || '', confidence: (reliable[0] || values[0])?.confidence ?? null,
      ...(distinct.length > 1 ? { candidates: distinct } : {}) };
  }
  const productName = field(/(?:商品名称|物资名称|物品名称|产品名称|商品信息|Productname)/i,
    value => value.length >= 2 && value.length <= 180 && !/订单编号|支付方式|实付款|付款金额/.test(value) ? value : '');
  const paidAmount = field(/(?:实付(?:款|金额|总额)?|实际付款|实际支付|付款金额|支付金额|支出金额|交易金额|支付成功|付款成功|Paymenttotal)(?![\d])/i, amountValue);
  // A refund or closed order needs human review even if an earlier payment remains visible.
  const exception = rows.some(row => /退款成功|已退款|交易关闭|支付失败/.test(row.text));
  if (exception) { paidAmount.state = 'conflict'; paidAmount.value = ''; paidAmount.evidence = '材料含退款、交易关闭或支付失败信息，请核对实际支出。'; }
  return { version: 1, productName, paidAmount };
}
