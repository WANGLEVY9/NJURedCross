/* BGM 曲风选择与语音播报文案的回归测试。
 * 两个模块在 import 阶段均不访问 window，可直接用 node --test 跑。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardSpeech, unoSpeech, UNO_SPEECH } from '../public/app/games/uno/announce.js';
import { BGM_TRACKS, findBgmTrack } from '../public/app/games/uno/bgm.js';

const card = (spec = {}) => ({
  id: 'm1', color: 'b', kind: 'number', value: 4, image: 'b4.webp', ...spec,
});

test('数字牌播报为「颜色+数字」，如蓝4、红5', () => {
  assert.equal(cardSpeech(card()), '蓝4');
  assert.equal(cardSpeech(card({ color: 'r', value: 5 })), '红5');
  assert.equal(cardSpeech(card({ color: 'y', value: 0 })), '黄0');
});

test('功能牌播报为「颜色+中文功能名」', () => {
  assert.equal(cardSpeech(card({ color: 'g', kind: 'draw2', value: null })), '绿加二');
  assert.equal(cardSpeech(card({ color: 'r', kind: 'skip', value: null })), '红禁止');
  assert.equal(cardSpeech(card({ color: 'b', kind: 'reverse', value: null })), '蓝反转');
});

test('万能牌不加颜色前缀', () => {
  assert.equal(cardSpeech(card({ color: null, kind: 'wild', value: null })), '变色');
  assert.equal(cardSpeech(card({ color: null, kind: 'wild4', value: null })), '加四');
  assert.equal(cardSpeech(null), '');
});

test('喊 UNO 只说「乌诺」，不带姓名或「只剩一张」', () => {
  assert.equal(unoSpeech(), UNO_SPEECH);
  assert.equal(unoSpeech(), '乌诺');
  assert.doesNotMatch(unoSpeech(), /喊|剩|张|UNO/i);
});

test('BGM 提供三种可选曲风，未知 id 回退默认', () => {
  assert.deepEqual(BGM_TRACKS.map((t) => t.id), ['calm', 'bright', 'groove']);
  assert.deepEqual(BGM_TRACKS.map((t) => t.name), ['舒缓', '欢快', '律动']);
  assert.equal(findBgmTrack('bright').name, '欢快');
  assert.equal(findBgmTrack('不存在的曲风').id, 'calm');
});

test('每个曲风都有合法 BPM、走向和旋律配置', () => {
  for (const track of BGM_TRACKS) {
    assert.ok(track.bpm >= 60 && track.bpm <= 200, `${track.name} BPM 应在合理范围`);
    assert.ok(track.progression.length >= 2, `${track.name} 至少两段和声`);
    assert.ok(track.melody.length >= 8, `${track.name} 旋律长度足够循环`);
    assert.ok(['sine', 'triangle', 'square'].includes(track.lead));
    assert.ok(track.leadGain > 0 && track.leadGain < 0.5);
  }
});
