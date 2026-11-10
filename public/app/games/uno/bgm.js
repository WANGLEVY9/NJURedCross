/* ==========================================================================
   南小红 UNO —— 内置游戏 BGM
   - 纯 Web Audio API 程序化合成：零外部音频文件、零网络请求、零版权风险，
     不引入任何 <audio src>，因此完全不触碰平台 CSP（default/script/connect-src 'self'）。
   - 浏览器自动播放策略要求用户手势，故默认关闭，必须由按钮点击调用 start()。
   - 只把音量偏好写入 localStorage；不自动恢复播放（无手势会被浏览器拦截）。
   ========================================================================== */

const STORE_KEY = 'nhrc-uno-bgm-volume';
const BPM = 96;
const STEP = 60 / BPM / 2;          // 八分音符时长（秒）
const LOOKAHEAD = 0.14;             // 提前调度窗口
const TICK_MS = 25;
const PENTATONIC = [0, 2, 4, 7, 9]; // C D E G A
const PROGRESSION = [
  [0, 4, 7],     // C
  [-3, 0, 4],    // Am
  [-7, -3, 0],   // F
  [-5, -1, 2],   // G
];
const MELODY = [0, 1, 2, 4, 5, 1, 0, 2, 4, 3, 6, 2, 1, 0, 1, 2];

const freq = (semitones) => 261.63 * (2 ** (semitones / 12));

export class UnoBgm {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.timer = null;
    this.nextTime = 0;
    this.step = 0;
    this.playing = false;
    this.volume = 0.12;
    this.readVolume();
  }

  get isOn() { return this.playing; }

  readVolume() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw === null) return;
      const value = Number(raw);
      if (Number.isFinite(value)) this.volume = Math.min(0.5, Math.max(0, value));
    } catch { /* 隐私模式忽略 */ }
  }

  setVolume(value) {
    this.volume = Math.min(0.5, Math.max(0, Number(value) || 0));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
    try { window.localStorage.setItem(STORE_KEY, String(this.volume)); } catch { /* 忽略 */ }
  }

  /** 切换开关；返回切换后是否正在播放。必须由用户手势触发。 */
  async toggle() {
    if (this.playing) { this.stop(); return false; }
    return this.start();
  }

  async start() {
    if (this.playing) return true;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return false;
    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        // 轻低通，让合成音色柔和一点，不刺耳。
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2800;
        this.master.connect(filter);
        filter.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch { return false; }
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
    return true;
  }

  stop() {
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    this.playing = false;
    // 不 suspend/close AudioContext：同一页面反复开关时避免旧浏览器的状态机坑。
  }

  dispose() {
    this.stop();
    if (this.ctx) {
      try { void this.ctx.close(); } catch { /* 忽略 */ }
      this.ctx = null;
      this.master = null;
    }
  }

  schedule() {
    if (!this.playing || !this.ctx) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextTime < horizon) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step += 1;
    }
  }

  playStep(step, time) {
    const bar = Math.floor(step / 8) % PROGRESSION.length;
    const chord = PROGRESSION[bar];
    const beat = step % 8;
    // 低音：每小节第 1、5 拍
    if (beat === 0 || beat === 4) this.tone(freq(chord[0] - 12), time, 0.44, 0.15, 'triangle');
    // 和弦垫：每小节第一拍，三音轻柔铺底
    if (beat === 0) {
      for (const note of chord) this.tone(freq(note), time, 0.92, 0.032, 'sine');
    }
    // 主旋律：五声音阶循环，偶数拍为主、第 4/8 拍加一个切分音
    if (beat % 2 === 0 || beat === 3 || beat === 7) {
      const note = PENTATONIC[MELODY[step % MELODY.length] % PENTATONIC.length];
      const octave = MELODY[step % MELODY.length] >= PENTATONIC.length ? 12 : 0;
      this.tone(freq(chord[0] + note + octave), time, 0.26, 0.085, 'sine');
    }
  }

  tone(hz, time, duration, gain, type) {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, time);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(time);
    osc.stop(time + duration + 0.03);
  }
}
