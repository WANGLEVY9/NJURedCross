/* ==========================================================================
   南小红 UNO —— 原生语音播报（Web Speech API）
   - 用浏览器内置 speechSynthesis，零依赖、零外部音频文件、不改平台 CSP
     （不引 CDN/脚本，只用原生 API）。
   - 默认关闭；必须由用户手势开启（顶栏按钮），状态存 localStorage 记忆。
   - 播报内容：每人打出的牌（如「蓝4」「红5」）、有人喊 UNO（只说「乌诺」）、胜负。
   - 联机与单机模式共用同一份事件检测逻辑（在 uno.js 的 render 里对比前后帧）。
   ========================================================================== */
import { COLOR_LABELS, KIND_LABELS } from './engine.js';

const STORE_KEY = 'nhrc-uno-announce';

/** 牌面转口语：数字牌「蓝4」「红5」，功能牌「黄加二」「加四」。 */
export function cardSpeech(card) {
  if (!card) return '';
  const color = card.color ? (COLOR_LABELS[card.color] || '') : '';
  if (card.kind === 'number') return `${color}${card.value}`;
  const kind = KIND_LABELS[card.kind] || '';
  return `${color}${kind}`.trim() || '万能牌';
}

/** 用中文谐音而非英文字母，确保中文嗓音读出「乌诺」而不是逐个念字母。 */
export const UNO_SPEECH = '乌诺';
export function unoSpeech() { return UNO_SPEECH; }

export class UnoAnnouncer {
  /** @param {{onStatus?: (text:string)=>void}} hooks */
  constructor({ onStatus = () => {} } = {}) {
    this.onStatus = onStatus;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.enabled = false;
    this.voice = null;
    // 仅当用户曾经主动开启过（localStorage 记 'on'）才默认开启；首次进默认关，
    // 避免无手势直接 speak 被浏览器拦截、也避免突兀出声。
    try {
      if (window.localStorage.getItem(STORE_KEY) === 'on') this.enabled = true;
    } catch { /* 隐私模式忽略 */ }
    if (this.enabled) this._pickVoice();
  }

  /** 在 voices 列表里挑一个中文嗓音；voices 可能异步加载，监听 onvoiceschanged 重试。 */
  _pickVoice() {
    if (!this.supported) return;
    const list = window.speechSynthesis.getVoices() || [];
    this.voice = list.find((v) => /^zh[-_]?CN/i.test(v.lang))
      || list.find((v) => /^zh/i.test(v.lang))
      || list.find((v) => /chinese|mandarin|中文|普通话/i.test(v.name || ''))
      || null;
    if (!this.voice && list.length === 0) {
      // 部分浏览器首次 getVoices() 为空，等 voiceschanged 再挑。
      window.speechSynthesis.onvoiceschanged = () => this._pickVoice();
    }
  }

  get status() {
    if (!this.supported) return '语音播报 · 不支持';
    return this.enabled ? '语音播报 · 开' : '语音播报 · 关';
  }

  /** 用户手势开启：先 cancel 再用一个静音探测 utterance 解锁语音通道。 */
  enable() {
    if (!this.supported) return false;
    try {
      window.speechSynthesis.cancel();
      this._pickVoice();
      const probe = new SpeechSynthesisUtterance(' ');
      probe.volume = 0; probe.lang = this.voice ? this.voice.lang : 'zh-CN';
      window.speechSynthesis.speak(probe);
    } catch { /* 忽略 */ }
    this.enabled = true;
    try { window.localStorage.setItem(STORE_KEY, 'on'); } catch { /* 忽略 */ }
    this.onStatus(this.status);
    return true;
  }

  disable() {
    this.enabled = false;
    try { window.speechSynthesis.cancel(); } catch { /* 忽略 */ }
    try { window.localStorage.setItem(STORE_KEY, 'off'); } catch { /* 忽略 */ }
    this.onStatus(this.status);
  }

  /** 切换；返回切换后是否开启。 */
  toggle() {
    if (this.enabled) { this.disable(); return false; }
    return this.enable();
  }

  /** 真正发声：统一中文 lang、略快语速，便于牌局里快速提示。 */
  say(text) {
    if (!this.enabled || !this.supported || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) u.voice = this.voice;
      u.lang = this.voice ? this.voice.lang : 'zh-CN';
      u.rate = 1.1; u.pitch = 1; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch { /* 忽略单条失败 */ }
  }

  /** 喊 UNO 时只报一声「乌诺」，不再拖出「某某喊 UNO，只剩一张牌」。 */
  uno() { this.say(unoSpeech()); }
  /** 每张打出的牌都报牌面，例如「蓝4」「红5」。 */
  played(card) { this.say(cardSpeech(card)); }
  oneCard(name) { this.say(`${name || '有人'} 还剩一张`); }
  win(name, isMe) { this.say(isMe ? '你赢了' : `${name || '有人'} 赢了`); }
  lose() { this.say('你输了'); }
}
