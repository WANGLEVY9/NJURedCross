/* ==========================================================================
   南小红 UNO —— 原生语音播报（Web Speech API）
   - 用浏览器内置 speechSynthesis，零依赖、零外部音频文件、不改平台 CSP
     （不引 CDN/脚本，只用原生 API）。
   - 默认关闭；必须由用户手势开启（顶栏按钮），状态存 localStorage 记忆。
   - 只播报关键事件：有人喊 UNO、有人剩一张、胜负，且优先中文嗓音（zh-CN / zh）。
   - 联机与单机模式共用同一份事件检测逻辑（在 uno.js 的 render 里对比前后帧）。
   ========================================================================== */

export class UnoAnnouncer {
  /** @param {{onStatus?: (text:string)=>void}} hooks */
  constructor({ onStatus = () => {} } = {}) {
    this.onStatus = onStatus;
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.enabled = false;
    this.voice = null;

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
      // Voice lists may populate later; retry on the next user action.
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
    this.onStatus(this.status);
    return true;
  }

  disable() {
    this.enabled = false;
    try { window.speechSynthesis.cancel(); } catch { /* 忽略 */ }
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

  uno(name) { this.say(`${name || '有人'} 喊 UNO`); }
  oneCard(name) { this.say(`${name || '有人'} 还剩一张`); }
  win(name, isMe) { this.say(isMe ? '你赢了' : `${name || '有人'} 赢了`); }
  lose() { this.say('你输了'); }
}
