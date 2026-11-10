/* ==========================================================================
   南小红 UNO —— 联机客户端
   同源短轮询同步状态，普通 POST 提交动作。全程不引第三方库、不改 CSP。
   ========================================================================== */

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
    this.view = null;
    this.closed = false;
  }

  get joined() { return Boolean(this.session); }

  get query() {
    const { seat, token } = this.session;
    return { 'X-Uno-Seat': String(seat), 'X-Uno-Token': token };
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
    if (this.view && Number(view.version) < Number(this.view.version)) return;
    this.view = view;
    this.onState(view);
  }

  connect() {
    if (!this.session || this.closed) return;
    this.disconnect();
    const poll = async () => {
      // Hidden tabs keep the heartbeat alive but stop polling room state.
      if (!this.session || this.closed || document.hidden) return;
      try {
        const response = await fetch(`${PREFIX}rooms/${encodeURIComponent(this.session.roomId)}/state`, { cache: 'no-store', headers: this.query });
        if (response.ok) {
          const data = await response.json();
          if (data.ok && (!this.view || Number(data.version) > Number(this.view.version))) this.apply(data);
        }
      } catch { /* 网络波动交给下一次轮询 */ }
    };
    this.pollTimer = window.setInterval(poll, 1500);
    this.heartbeat = window.setInterval(() => { void this.action('ping'); }, 15000);
    void poll();
  }

  disconnect() {
    if (this.source) { this.source.close(); this.source = null; }
    if (this.pollTimer) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.heartbeat) { window.clearInterval(this.heartbeat); this.heartbeat = null; }
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
