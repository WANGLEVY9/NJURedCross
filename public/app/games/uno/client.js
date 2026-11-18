/* ==========================================================================
   南小红 UNO —— 联机客户端
   同源 SSE 推状态 + 普通 POST 提交动作；低频轮询只做 version 对齐兜底，
   防止 SSE 偶发丢帧或被代理缓冲。全程不引第三方库、不改 CSP。
   第十二版：相同 version 直接丢弃、SSE 正常时拉长轮询、带 version 轮询
   短路、切后台暂停心跳与轮询 —— 显著降低联机加载开销与常驻内存。
   ========================================================================== */

import { request as sharedRequest } from '../../core/api.js';

const STORE_KEY = 'nhrc-uno-room';
const PREFIX = '/api/games/uno/';

function loadSession() {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.roomId && data.token ? data : null;
  } catch { return null; }
}

function saveSession(data) {
  try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* 隐私模式下忽略 */ }
}

export class UnoClient {
  /** @param {{onState: (view:object)=>void, onError?: (message:string)=>void}} hooks */
  constructor({ onState, onError = () => {} } = {}) {
    this.onState = onState;
    this.onError = onError;
    this.session = loadSession();
    this.source = null;
    this.pollTimer = null;
    this.heartbeat = null;
    this.visibilityHandler = null;
    this.view = null;
    this.closed = false;
  }

  get joined() { return Boolean(this.session); }

  get query() {
    const { seat, token } = this.session;
    return `seat=${encodeURIComponent(seat)}&token=${encodeURIComponent(token)}`;
  }

  async request(path, body) {
    const response = await fetch(`${PREFIX}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.message || `请求失败（${response.status}）`);
    return data;
  }

  async create(name) {
    const data = await this.request('rooms', { name });
    this.session = { roomId: data.roomId, seat: data.seat, token: data.token, name };
    saveSession(this.session);
    return this.session;
  }

  async join(roomId, name) {
    const id = String(roomId || '').trim().toUpperCase();
    if (!id) throw new Error('请填写房间码');
    const data = await this.request(`rooms/${encodeURIComponent(id)}/join`, { name });
    this.session = { roomId: data.roomId, seat: data.seat, token: data.token, name };
    saveSession(this.session);
    return this.session;
  }

  /** 提交动作；失败只提示，不改动本地状态（服务端才是权威）。 */
  async action(type, extra = {}) {
    if (!this.session) return;
    try {
      // 凭证放请求体，避免 token 出现在 URL 与访问日志里；SSE/轮询因
      // EventSource 无法设 header，才把它们放在同源 query 上。
      await this.request(`rooms/${encodeURIComponent(this.session.roomId)}/action`, {
        type, ...extra, seat: this.session.seat, token: this.session.token,
      });
    } catch (error) {
      this.onError(error.message || '操作没有生效');
    }
  }

  /** 质疑上一张 +4。 */
  async challenge() {
    return this.action('challenge');
  }

  /** 摸牌后选择不出，跳过本回合。 */
  async pass() {
    return this.action('pass');
  }

  /** 发送一条房间聊天消息。 */
  async sendChat(text) {
    return this.action('chat', { text });
  }

  /** 语音连麦信令：服务端只做转发与投影，不理解 SDP 内容。 */
  async sendSignal(signal) {
    return this.action('rtc', { signal });
  }

  /** 读取生产下发的 ICE 配置；失败时静默退回前端内置公共 STUN。 */
  async loadIce() {
    try {
      const data = await sharedRequest(`${PREFIX}config`);
      return Array.isArray(data?.iceServers) ? data.iceServers : [];
    } catch { return []; }
  }

  /** 房主设定胜负判定方式：'first' | 'elimination'。 */
  async setRule(winCondition) {
    return this.action('rule', { winCondition });
  }

  /** 手里剩两张时喊 UNO（忘喊会被罚抽 2 张）。 */
  async callUno() {
    return this.action('uno');
  }

  apply(view) {
    if (!view || this.closed) return;
    // version 由服务端 broadcast 单调递增，相同 version 必定是同一份状态。
    // SSE 与轮询常把同一帧推送多次；重复 onState 会整页重建 DOM，手机端尤卡。
    if (this.view && Number(view.version) <= Number(this.view.version)) return;
    this.view = view;
    this.onState(view);
  }

  connect() {
    if (!this.session || this.closed) return;
    this.disconnect();
    const url = `${PREFIX}rooms/${encodeURIComponent(this.session.roomId)}/events?${this.query}`;
    try {
      this.source = new EventSource(url);
      this.source.addEventListener('state', (event) => {
        try { this.apply(JSON.parse(event.data)); } catch { /* 忽略坏帧 */ }
      });
      this.source.addEventListener('error', () => {
        // EventSource 自带重连；轮询兜底会在断线期间继续对齐状态。
        this.onError('连接波动，正在自动重连…');
      });
    } catch {
      this.source = null;
    }

    const poll = async () => {
      if (!this.session || this.closed || document.hidden) return;
      try {
        // 带上已知 version：服务端状态未变时只回极小的 unchanged 包，
        // 不再做全量投影与 JSON 序列化（轮询绝大多数时候都命中这里）。
        const version = this.view ? `&version=${encodeURIComponent(this.view.version)}` : '';
        const data = await sharedRequest(
          `${PREFIX}rooms/${encodeURIComponent(this.session.roomId)}/state?${this.query}${version}`,
        );
        if (data?.ok && !data.unchanged) this.apply(data);
      } catch { /* 网络波动交给下一次轮询 */ }
    };

    const sseOk = () => this.source && this.source.readyState === 1;
    const tick = () => {
      if (!this.session || this.closed) return;
      void poll();
      // SSE 正常时轮询只是兜底，间隔拉长到 10s；断线时缩短到 3s 尽快对齐。
      this.pollTimer = window.setTimeout(tick, sseOk() ? 10000 : 3000);
    };
    this.pollTimer = window.setTimeout(tick, 0);

    this.heartbeat = window.setInterval(() => {
      if (!document.hidden) void this.action('ping');
    }, 30000);

    // 切回前台立刻对齐一次；后台不做轮询/心跳，省流量与内存。
    this.visibilityHandler = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  disconnect() {
    if (this.source) { this.source.close(); this.source = null; }
    if (this.pollTimer) { window.clearTimeout(this.pollTimer); this.pollTimer = null; }
    if (this.heartbeat) { window.clearInterval(this.heartbeat); this.heartbeat = null; }
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  leave() {
    this.disconnect();
    this.session = null;
    this.view = null;
    try { window.sessionStorage.removeItem(STORE_KEY); } catch { /* 忽略 */ }
  }

  close() {
    this.closed = true;
    this.disconnect();
  }
}
