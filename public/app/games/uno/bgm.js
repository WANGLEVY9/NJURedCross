/* ==========================================================================
   南小红 UNO —— 内置游戏 BGM（可按曲风选择）
   - 纯 Web Audio API 程序化合成：零外部音频文件、零网络请求、零版权风险，
     不引入任何 <audio src>，因此完全不触碰平台 CSP（default/script/connect-src 'self'）。
   - 浏览器自动播放策略要求用户手势，故默认关闭，必须由按钮点击调用 start()。
   - 提供舒缓 / 欢快 / 律动三种曲风，切换即时生效；音量与曲风写入 localStorage。
     不自动恢复播放（无手势会被浏览器拦截）。
   ========================================================================== */

const STORE_KEY = 'nhrc-uno-bgm-volume';
const TRACK_STORE_KEY = 'nhrc-uno-bgm-track';
const LOOKAHEAD = 0.14;             // 提前调度窗口
const TICK_MS = 25;
const PENTATONIC = [0, 2, 4, 7, 9]; // C D E G A

/** 三种曲风共用五声音阶，靠速度、和声走向、音色与轻打击区分，不引入任何素材。 */
export const BGM_TRACKS = [
  {
    id: 'calm', name: '舒缓', bpm: 88,
    progression: [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]],
    melody: [0, 1, 2, 4, 5, 1, 0, 2, 4, 3, 6, 2, 1, 0, 1, 2],
    bass: 'triangle', lead: 'sine',
    bassGain: 0.13, padGain: 0.03, leadGain: 0.08,
    syncopation: true, hat: false,
  },
  {
    id: 'bright', name: '欢快', bpm: 128,
    progression: [[0, 4, 7], [5, 9, 12], [-5, -1, 2], [7, 11, 14]],
    melody: [0, 2, 4, 2, 5, 4, 2, 1, 0, 2, 4, 5, 4, 2, 1, 0],
    bass: 'triangle', lead: 'triangle',
    bassGain: 0.11, padGain: 0.022, leadGain: 0.09,
    syncopation: false, hat: false,
  },
  {
    id: 'groove', name: '律动', bpm: 108,
    progression: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]],
    melody: [0, 0, 2, 4, 2, 5, 4, 2, 0, 1, 2, 4, 5, 2, 1, 0],
    bass: 'sine', lead: 'triangle',
    bassGain: 0.15, padGain: 0.018, leadGain: 0.07,
    syncopation: true, hat: true,
  },
];

export function findBgmTrack(id) {
  return BGM_TRACKS.find((track) => track.id === id) || BGM_TRACKS[0];
}

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
    this.trackId = BGM_TRACKS[0].id;
    this.readVolume();
    this.readTrack();
  }

  get isOn() { return this.playing; }
  get tracks() { return BGM_TRACKS; }
  get track() { return findBgmTrack(this.trackId); }
  /** 八分音符时长随所选曲风的 BPM 变化。 */
  get stepDur() { return 60 / this.track.bpm / 2; }

  readVolume() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw === null) return;
      const value = Number(raw);
      if (Number.isFinite(value)) this.volume = Math.min(0.5, Math.max(0, value));
    } catch { /* 隐私模式忽略 */ }
  }

  readTrack() {
    try {
      const id = window.localStorage.getItem(TRACK_STORE_KEY);
      if (id && BGM_TRACKS.some((track) => track.id === id)) this.trackId = id;
    } catch { /* 隐私模式忽略 */ }
  }

  setVolume(value) {
    this.volume = Math.min(0.5, Math.max(0, Number(value) || 0));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.04);
    }
    try { window.localStorage.setItem(STORE_KEY, String(this.volume)); } catch { /* 忽略 */ }
  }

  /** 切换曲风；正在播放时从新曲子第一拍重新开始，返回生效后的 trackId。 */
  setTrack(id) {
    const next = findBgmTrack(id);
    if (this.trackId !== next.id) {
      this.trackId = next.id;
      if (this.playing && this.ctx) {
        this.step = 0;
        this.nextTime = this.ctx.currentTime + 0.05;
      }
    }
    try { window.localStorage.setItem(TRACK_STORE_KEY, this.trackId); } catch { /* 忽略 */ }
    return this.trackId;
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
      this.nextTime += this.stepDur;
      this.step += 1;
    }
  }

  playStep(step, time) {
    const track = this.track;
    const bar = Math.floor(step / 8) % track.progression.length;
    const chord = track.progression[bar];
    const beat = step % 8;
    // 低音：每小节第 1、5 拍；律动档在第 7 拍补一下。
    if (beat === 0 || beat === 4 || (track.hat && beat === 6)) {
      this.tone(freq(chord[0] - 12), time, 0.44, track.bassGain, track.bass);
    }
    // 和弦垫：每小节第一拍，三音轻柔铺底
    if (beat === 0) {
      for (const note of chord) this.tone(freq(note), time, 0.92, track.padGain, 'sine');
    }
    // 主旋律：五声音阶循环；切分音仅舒缓 / 律动档保留。
    const noteIndex = track.melody[step % track.melody.length];
    if (beat % 2 === 0 || (track.syncopation && (beat === 3 || beat === 7))) {
      const note = PENTATONIC[noteIndex % PENTATONIC.length];
      const octave = noteIndex >= PENTATONIC.length ? 12 : 0;
      this.tone(freq(chord[0] + note + octave), time, 0.26, track.leadGain, track.lead);
    }
    // 轻打击：只用短促正弦点击，律动档才出现。
    if (track.hat && beat % 2 === 1) this.tone(1500, time, 0.035, 0.012, 'sine');
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
