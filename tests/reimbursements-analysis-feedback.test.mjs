import test from 'node:test';
import assert from 'node:assert/strict';
import { materialAnalysisFeedback } from '../public/app/shared/material-analysis-feedback.js';
import { processLocalAnalysis } from '../lib/reimbursements/analysis-processor.js';
import { pictureFixture } from './helpers/reimbursement-materials.js';

const bundle = { sources: [
  { kind: 'invoice', startPage: 1, endPage: 1 },
  { kind: 'supporting', materialType: '订单截图', startPage: 2, endPage: 2 },
  { kind: 'supporting', materialType: '付款截图', startPage: 3, endPage: 3 },
  { kind: 'supporting', materialType: '订单和付款截图', startPage: 4, endPage: 5 },
] };
const unknown = { state: 'unknown', value: '' }, extracted = { state: 'extracted', value: 'synthetic' };
test('unreadable order and payment evidence identifies its page, expected type and missing field', () => {
  const results = materialAnalysisFeedback(bundle, { analyses: [
    { page: 2, supporting: { productName: unknown } },
    { page: 3, supporting: { paidAmount: unknown } },
    { page: 5, supporting: { productName: extracted, paidAmount: unknown } },
  ] });
  assert.equal(results.length, 3);
  assert.match(results[0].message, /第 2 页（订单截图）.*未提取到有效物资名.*清晰、完整的订单截图/);
  assert.match(results[1].message, /第 3 页（付款截图）.*未提取到有效付款金额.*付款截图/);
  assert.match(results[2].message, /第 5 页（订单和付款截图）.*未提取到有效付款金额/);
  assert.ok(results.every(result => !/实物照片|不合格|缺少发票/.test(result.message)));
});
test('a legacy rejection describes unavailable service support without pretending OCR was attempted', () => {
  const result = materialAnalysisFeedback(bundle, { errors: [{ page: 2, message: '补充材料不进行发票识别，请查看原件。' }] })[0];
  assert.equal(result.type, 'service'); assert.match(result.message, /第 2 页（订单截图）.*当前识别服务尚未支持/);
  assert.doesNotMatch(result.message, /未提取到|识别失败|实物照片/);
});
test('conflicting payments and refunds stay distinct from unreadable text', () => {
  const result = materialAnalysisFeedback(bundle, { analyses: [{ page: 3, supporting: { paidAmount: { state: 'conflict', value: '' } } }] })[0];
  assert.equal(result.type, 'conflict'); assert.match(result.message, /付款金额信息存在冲突.*退款/); assert.doesNotMatch(result.message, /未提取到/);
});
test('recognized fields have no bottom warning, and irrelevant fields are not required', () => {
  assert.deepEqual(materialAnalysisFeedback(bundle, { analyses: [
    { page: 2, supporting: { productName: extracted, paidAmount: unknown } },
    { page: 3, supporting: { productName: unknown, paidAmount: extracted } },
  ] }), []);
  assert.deepEqual(materialAnalysisFeedback(bundle, { analyses: [] }), []);
});
test('timeouts, authorization errors and absent results are not presented as wrong uploads', () => {
  const result = materialAnalysisFeedback(bundle, { errors: [{ page: 3, message: '需要对应的财务审核权限。' }], analyses: [{ page: 3 }] });
  assert.equal(result.length, 1); assert.match(result[0].message, /识别未完成.*审核权限/); assert.doesNotMatch(result[0].message, /清晰、完整/);
  const missing = materialAnalysisFeedback(bundle, { analyses: [{ page: 2 }] })[0];
  assert.equal(missing.type, 'unavailable'); assert.match(missing.message, /尚无有效/);
});

test('an image without receipt text runs offline OCR and gives an evidence reminder without inventing a material classification', async () => {
  const analysis = await processLocalAnalysis({ bytes: pictureFixture('png'), pageNumber: 1, materialKind: 'supporting', materialType: '付款截图', originalName: 'synthetic-photo.png' });
  assert.equal(analysis.method, 'local-ocr-and-image'); assert.equal(analysis.supporting.paidAmount.state, 'unknown');
  const feedback = materialAnalysisFeedback(bundle, { analyses: [{ ...analysis, page: 3 }] });
  assert.equal(feedback[0].type, 'unrecognized'); assert.match(feedback[0].message, /确认该页是否为清晰、完整的付款截图/);
  assert.doesNotMatch(feedback[0].message, /实物照片|不合格|不进行发票识别/);
});

test('JPEG supporting material survives IPC buffer offsets without changing its bytes', async () => {
  const image = pictureFixture('jpg'), backing = Buffer.alloc(image.length + 37);
  image.copy(backing, 37); const bytes = backing.subarray(37);
  const analysis = await processLocalAnalysis({ bytes, pageNumber: 1, materialKind: 'supporting', materialType: '付款截图', originalName: 'synthetic-photo.JPG' });
  assert.equal(analysis.method, 'local-ocr-and-image'); assert.equal(analysis.supporting.paidAmount.state, 'unknown');
  assert.deepEqual(bytes, image);
});
