import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALLOWED_UPLOAD_HINT, DIRECT_UPLOAD_MAX_BYTES, FILE_RULES,
  RELAY_UPLOAD_MAX_BYTES, SPREADSHEET_MIME_PATTERN, fileRuleFor,
  uploadTimeoutFor } from '../public/app/shared/upload-limits.js';

const MB = 1024 * 1024;

test('常见文档、图片和压缩包按更大上限放行', () => {
  const cases = [
    ['image/jpeg', 'photo.jpg', 100 * MB],
    ['image/heic', 'photo.HEIC', 100 * MB],
    ['application/pdf', '合同.pdf', 200 * MB],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '稿件.docx', 200 * MB],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '课件.pptx', 200 * MB],
    [SPREADSHEET_MIME_PATTERN.source.startsWith('^') ? 'text/csv' : 'text/csv', '名单.csv', 200 * MB],
    ['application/zip', '素材.zip', 500 * MB],
    ['video/mp4', '现场.mp4', 500 * MB],
    ['audio/mpeg', '采访.mp3', 200 * MB],
  ];
  for (const [mime, name, max] of cases) {
    const rule = fileRuleFor(mime, name);
    assert.ok(rule, `${name} 应受支持`);
    assert.equal(rule.maxSize, max, name);
  }
  assert.ok(DIRECT_UPLOAD_MAX_BYTES >= 500 * MB, '直传需要容纳最大文件档');
  assert.ok(RELAY_UPLOAD_MAX_BYTES <= 128 * MB, '中转不能超过 nginx 请求体上限');
});

test('未知 MIME 只按明确白名单扩展名兜底，可执行内容仍拒绝', () => {
  assert.equal(fileRuleFor('', '清单.xlsx')?.kind, 'spreadsheet');
  assert.equal(fileRuleFor('application/octet-stream', '海报.PDF')?.kind, 'pdf');
  assert.equal(fileRuleFor('', '报告.txt')?.kind, 'document');
  assert.equal(fileRuleFor('application/octet-stream', '木马.exe'), null);
  assert.equal(fileRuleFor('text/html', '看起来是.txt'), null);
  assert.equal(fileRuleFor('image/svg+xml', '图标.svg'), null);
  assert.ok(FILE_RULES.length >= 8);
  assert.match(ALLOWED_UPLOAD_HINT, /PDF（200MB）/);
});

test('浏览器超时按文件大小增长但有上限', () => {
  assert.equal(uploadTimeoutFor(1 * MB), 5 * 60 * 1000);
  assert.equal(uploadTimeoutFor(100 * MB), 14 * 60 * 1000);
  assert.equal(uploadTimeoutFor(500 * MB), 30 * 60 * 1000);
  assert.equal(uploadTimeoutFor(0), 5 * 60 * 1000);
});

test('投稿页不再复制文件类型矩阵', async () => {
  const source = await readFile(new URL('../public/app/portal/pages/submit.js', import.meta.url), 'utf8');
  assert.match(source, /shared\/upload-limits\.js/);
  assert.doesNotMatch(source, /const SPREADSHEET_MIME\s*=/);
});
