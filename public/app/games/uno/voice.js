/* ==========================================================================
   南小红 UNO —— 联机语音连麦
   - 纯 WebRTC（getUserMedia + RTCPeerConnection 网状直连），不引第三方库、不加
     WebSocket/socket.io、不改平台 CSP；WebRTC 的 ICE/DTLS 走 UDP，不受 connect-src 管。
   - 信令复用 UNO 房间已有的「同源 SSE 推状态 + POST action」通道：新增 rtc 动作，
     只改 lib/games/uno-room.js（UNO 自己的模块），不碰 server.js / 平台页面。
   - 默认关闭、必须用户手势开启；只与同房间的在线真人席位建连。
   - ⚠️ 无 TURN 服务器时，跨运营商 / 对称 NAT 的公网用户可能连不上（host + srflx
     候选失败）。生产要稳定需自建 coturn 并通过 UNO_RTC_ICE_JSON 下发，见交付说明。
   ========================================================================== */

const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

function requestMic() {
  const constraints = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  };
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  // 旧版 Chromium / Safari：走带回调的 legacy 接口。
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) return Promise.reject(new Error('unsupported'));
  return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
}

export class UnoVoice {
  /**
   * @param {{sendSignal:(payload:object)=>void, onStatus?:(text:string)=>void,
   *          onPeers?:(count:number)=>void}} hooks
   */
  constructor({ sendSignal, onStatus = () => {}, onPeers = () => {} } = {}) {
    this.sendSignal = sendSignal;
    this.onStatus = onStatus;
    this.onPeers = onPeers;
    this.active = false;
    this.muted = false;
    this.status = '未开启';
    this.seat = null;
    this.roomKey = null;
    this.seats = [];
    this.stream = null;
    this.peers = new Map();       // peerSeat -> { pc, audio }
    this.seen = new Set();        // 已消费的信令 id（SSE 与轮询会重复推送）
    this.iceServers = DEFAULT_ICE.slice();
  }

  setIce(servers) {
    if (Array.isArray(servers) && servers.length) this.iceServers = servers;
  }

  get peerCount() { return this.peers.size; }

  setStatus(text) {
    this.status = text;
    this.onStatus(text);
  }

  send(payload) {
    if (this.sendSignal) this.sendSignal(payload);
  }

  /** 每次收到房间投影时调用：同步席位、清理离场连接、消费新信令。 */
  sync(view) {
    if (!view) return;
    const key = `${view.roomId || ''}:${view.seat}`;
    if (this.roomKey && this.roomKey !== key) {
      for (const peer of [...this.peers.keys()]) this.closePeer(peer);
      this.seen.clear();
    }
    this.roomKey = key;
    this.seat = Number(view.seat);
    this.seats = (view.seats || []).map((entry, index) => ({ ...entry, index }));

    const live = new Set(this.seats
      .filter((entry) => entry.index !== this.seat && entry.kind === 'human' && entry.connected)
      .map((entry) => entry.index));
    if (this.active) {
      for (const peer of [...this.peers.keys()]) if (!live.has(peer)) this.closePeer(peer);
    }

    for (const signal of (view.rtc || [])) {
      if (!signal || !signal.id || this.seen.has(signal.id) || Number(signal.from) === this.seat) continue;
      if (signal.to !== null && signal.to !== undefined && Number(signal.to) !== this.seat) continue;
      this.seen.add(signal.id);
      void this.handleSignal(signal);
    }
    if (this.seen.size > 400) this.seen = new Set([...this.seen].slice(-200));
    if (this.active) this.ensurePeers();
    this.onPeers(this.peers.size);
  }

  /** 开启麦克风并广播 hello；只有席位号更小的一方向对方发 offer，避免 offer 冲突。 */
  async start() {
    if (this.active) return true;
    const Ctor = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (!Ctor) { this.setStatus('当前浏览器不支持语音连麦'); return false; }
    try {
      this.stream = await requestMic();
    } catch (error) {
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      this.setStatus(denied ? '麦克风权限被拒绝' : '无法打开麦克风');
      return false;
    }
    this.active = true;
    this.muted = false;
    this.setStatus('语音已开启');
    this.send({ to: null, kind: 'hello', data: null });
    this.ensurePeers();
    this.onPeers(this.peers.size);
    return true;
  }

  stop() {
    if (this.active) this.send({ to: null, kind: 'bye', data: null });
    this.active = false;
    this.muted = false;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    for (const peer of [...this.peers.keys()]) this.closePeer(peer);
    this.setStatus('未开启');
    this.onPeers(0);
  }

  dispose() {
    this.stop();
    this.seen.clear();
  }

  /** 切换静音，返回切换后是否静音。 */
  toggleMute() {
    if (!this.active || !this.stream) return this.muted;
    this.muted = !this.muted;
    for (const track of this.stream.getAudioTracks()) track.enabled = !this.muted;
    return this.muted;
  }

  ensurePeers() {
    if (!this.active || !Number.isInteger(this.seat)) return;
    for (const entry of this.seats) {
      if (entry.index === this.seat || entry.kind !== 'human' || !entry.connected) continue;
      // 单向 offer：席位号小的一方发起，天然避免双方同时 offer 的 glare。
      if (this.seat < entry.index) void this.ensureOffer(entry.index);
    }
  }

  async ensureOffer(peer) {
    if (!this.active || !Number.isInteger(this.seat) || this.seat >= peer) return;
    if (this.peers.has(peer)) return;
    let pc;
    try {
      pc = this.createPeer(peer);
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      this.send({ to: peer, kind: 'offer', data: pc.localDescription });
    } catch {
      this.closePeer(peer);
    }
  }

  async handleSignal(signal) {
    const peer = Number(signal.from);
    if (!Number.isInteger(peer) || peer === this.seat) return;
    if (signal.kind === 'bye') { this.closePeer(peer); return; }
    if (signal.kind === 'hello') {
      // 对方刚开麦：若我这席位更小，由我发起 offer，不必等对方重发。
      if (this.active) void this.ensureOffer(peer);
      return;
    }
    if (!this.active || !signal.data) return;
    let pc = this.peers.get(peer)?.pc;
    if (!pc) pc = this.createPeer(peer);
    try {
      if (signal.kind === 'offer') {
        await pc.setRemoteDescription(signal.data);
        // 旧浏览器可能没有 getSenders；有流且尚未加轨时补一次。
        const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : [];
        if (this.stream && !senders.length) {
          for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ to: peer, kind: 'answer', data: pc.localDescription });
      } else if (signal.kind === 'answer') {
        if (pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(signal.data);
      } else if (signal.kind === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(signal.data);
      }
    } catch { /* 单条信令失败不拆连接，等下一轮 hello/offer 重建 */ }
  }

  createPeer(peer) {
    const Ctor = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    const pc = new Ctor({ iceServers: this.iceServers, iceCandidatePoolSize: 2 });
    const entry = { pc, audio: null };
    this.peers.set(peer, entry);
    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) this.send({ to: peer, kind: 'candidate', data: event.candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      if (entry.audio) return;
      const stream = event.streams[0];
      if (!stream) return;
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.className = 'uno-voice-audio';
      audio.srcObject = stream;
      document.body.append(audio);
      entry.audio = audio;
      void audio.play().catch(() => { /* 用户手势已发生过，个别浏览器仍可能拒绝 */ });
    };
    const check = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed'
        || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        this.closePeer(peer);
      }
    };
    pc.onconnectionstatechange = check;
    pc.oniceconnectionstatechange = check;
    this.onPeers(this.peers.size);
    return pc;
  }

  closePeer(peer) {
    const entry = this.peers.get(peer);
    if (!entry) return;
    this.peers.delete(peer);
    try { entry.pc.close(); } catch { /* 忽略 */ }
    if (entry.audio) { entry.audio.srcObject = null; entry.audio.remove(); }
    this.onPeers(this.peers.size);
  }
}
