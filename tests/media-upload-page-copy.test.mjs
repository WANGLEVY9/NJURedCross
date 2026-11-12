import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MEDIA_CENTERS } from '../lib/attachment/store.js';

/**
 * 影像上传页（/photos）的界面文案必须跟着白名单走。
 *
 * 苏州分部撤并后，下拉只剩 4 项；但页面曾经把「共 5 个中心」和「生命/博爱/综事/苏州/主席团」
 * 写死在提示与告警里，等于指引用户去选一个不存在的选项。这里守住两条：不许再写死数量、
 * 不许再把已撤并的中心列进文案；名单一律取接口返回的 state.centers。
 */
const source = readFileSync(new URL('../public/app/portal/pages/photos.js', import.meta.url), 'utf8');

test('影像上传页不写死归档中心数量', () => {
  assert.doesNotMatch(source, /共\s*\d+\s*个中心/, '中心数量会随白名单变化，不应写死在文案里');
  assert.deepEqual([...MEDIA_CENTERS], ['生命中心', '博爱中心', '综事中心', '主席团活动']);
});

test('影像上传页文案不再列出已撤并的苏州分部', () => {
  assert.equal(source.includes('苏州'), false, '归档中心已无苏州分部，界面文案不应再出现它');
});

test('未选中心的告警按接口返回的中心名单拼装', () => {
  assert.match(source, /state\.centers/, '告警应从 state.centers 取名单，避免与白名单再次漂移');
  assert.match(source, /请选择照片归入哪个中心/);
});
