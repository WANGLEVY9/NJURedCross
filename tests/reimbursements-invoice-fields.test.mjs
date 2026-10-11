import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInvoiceFields, invoiceBuyer } from '../lib/reimbursements/invoice-fields.js';

const box = (text, x, y, width = .15, confidence = null) => ({ text, x, y, width, height: .02, confidence });
function invoice() {
  return [
    ...[...'购买方信息'].map((text, index) => box(text, .02, .25 + index * .027, .01)),
    ...[...'销售方信息'].map((text, index) => box(text, .52, .25 + index * .027, .01)),
    box('名称：', .07, .25, .05), box('南京大学', .13, .25, .17),
    box('名称：', .57, .25, .05), box('测试销售公司', .63, .25, .27),
    box('统一社会信用代码/纳税人识别号：', .07, .32, .24), box('123456789012345678', .32, .32, .18),
    box('纳税人识别号：', .57, .32, .16), box('987654321098765432', .74, .32, .2),
    box('发票号码：', .62, .06, .12), box('26942000000071512051', .75, .06, .23),
    box('开票日期：', .62, .10, .12), box('2026年01月29日', .75, .10, .23),
    box('项目名称', .07, .45), box('单价', .6, .45), box('2.39', .7, .45),
    box('合计', .07, .63), box('金额 ¥86.14', .7, .63), box('税额 ¥0.86', .87, .63),
    box('价税合计（大写）', .08, .72, .25), box('捌拾柒元整', .35, .72),
    box('（小写）', .67, .72, .12), box('¥87.00', .8, .72, .12),
  ];
}

test('vertical party labels and separate columns yield all six fields regardless of PDF item order', () => {
  const result = extractInvoiceFields(invoice().reverse());
  assert.equal(result.complete, true);
  assert.deepEqual(Object.fromEntries(Object.entries(result.fields).map(([key, field]) => [key, field.value])), {
    buyerName: '南京大学', buyerTaxId: '123456789012345678', sellerName: '测试销售公司',
    invoiceNumber: '26942000000071512051', invoiceDate: '2026-01-29', totalAmount: '87.00',
  });
  assert.equal(invoiceBuyer(result).state, 'matched');
});

test('seller, item description and university-name prefixes cannot prove the buyer is NJU', () => {
  const values = invoice().map(value => ({ ...value, text: value.text === '南京大学' ? '其他购买单位' : value.text === '测试销售公司' ? '南京大学' : value.text }));
  const result = extractInvoiceFields(values);
  assert.equal(invoiceBuyer(result).state, 'different');
  assert.equal(result.fields.buyerName.value, '其他购买单位');
  const prefix = extractInvoiceFields(invoice().map(value => ({ ...value, text: value.text === '南京大学' ? '南京大学附属医院' : value.text })));
  assert.equal(invoiceBuyer(prefix).state, 'different');
  const onlySeller = extractInvoiceFields(invoice().filter(value => value.x >= .52), { text: '活动南京大学，销售方名称：南京大学' });
  assert.equal(invoiceBuyer(onlySeller).state, 'unknown');
});

test('subtotals never substitute for a missing tax-inclusive amount and invalid dates stay empty', () => {
  const result = extractInvoiceFields(invoice().filter(value => value.y !== .72).map(value => ({ ...value,
    text: value.text === '2026年01月29日' ? '2026年02月30日' : value.text })));
  assert.equal(result.fields.totalAmount.state, 'unknown'); assert.equal(result.fields.totalAmount.value, '');
  assert.equal(result.fields.invoiceDate.state, 'unknown'); assert.equal(result.complete, false);
});

test('conflicting buyer names and low-confidence OCR remain explicit uncertainty', () => {
  const conflicted = extractInvoiceFields([...invoice(), box('名称：另一个单位', .07, .29, .3)]);
  assert.equal(conflicted.fields.buyerName.state, 'conflict'); assert.equal(invoiceBuyer(conflicted).state, 'unknown');
  const low = extractInvoiceFields(invoice().map(value => ({ ...value, confidence: 40 })), { method: 'local-ocr' });
  assert.equal(low.fields.invoiceNumber.state, 'unknown'); assert.equal(low.fields.invoiceNumber.value, '');
  assert.equal(invoiceBuyer(low).state, 'unknown');
});
