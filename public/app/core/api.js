import { createPublicReadCache } from './public-read-cache.js';
import { reportTiming } from './telemetry.js';
/* ==========================================================================
   api.js — the single network boundary.
   The browser never holds a SeaTable token: every call goes to this origin's
   /api/* surface, which performs authorisation, masking and validation.
   ========================================================================== */



export class ApiError extends Error {
  constructor(message, { status = 0, detail = null, path = '', code = '' } = {}) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.path = path;
    this.code = code;
  }

  get isAuth() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isConflict() {
    return this.status === 409;
  }
  get isRateLimited() {
    return this.status === 429;
  }
  get isOffline() {
    return this.status === 0;
  }
}

const state = {
  csrfToken: null,
  user: null,
  expiresAt: null,
};

const listeners = new Set();
let sessionVersion = 0;
let profileVersion = 0;
let profileCache = null;
let profilePending = null;
const PROFILE_CACHE_MS = 60_000;

function clearProfileCache() {
  profileVersion++;
  profileCache = null;
  profilePending = null;
}

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitSession() {
  for (const listener of listeners) listener(getSessionState());
}

export function getSessionState() {
  return { user: state.user, csrfToken: state.csrfToken, expiresAt: state.expiresAt, authenticated: Boolean(state.user) };
}

/**
 * Whether the signed-in account may open the operations console. The server is
 * the authority; this only lets the router send people to the right surface
 * instead of showing them a wall of 403s.
 */
export function hasConsoleAccess() {
  return state.user?.consoleAccess === true;
}

export function hasPermission(scope) {
  if (!scope) return true;
  return hasConsoleAccess() && Array.isArray(state.user?.permissions) && state.user.permissions.includes(scope);
}

function setSession(payload) {
  sessionVersion++;
  if (!payload?.user || payload.csrfToken !== state.csrfToken || payload.user.username !== state.user?.username || payload.user.consoleAccess !== state.user?.consoleAccess || JSON.stringify(payload.user.permissions) !== JSON.stringify(state.user?.permissions)) {clearProfileCache();invalidateManagementReads();}
  state.csrfToken = payload?.csrfToken || null;
  state.user = payload?.user || null;
  state.expiresAt = payload?.expiresAt || null;
  emitSession();
}

async function parse(response, path, onProgress) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    let payload;
    try {
      if(onProgress&&response.body?.getReader){
        const reader=response.body.getReader(),decoder=new TextDecoder(),chunks=[];
        try{
          while(true){const {done,value}=await reader.read();if(done)break;onProgress();chunks.push(decoder.decode(value,{stream:true}));}
          chunks.push(decoder.decode());payload=JSON.parse(chunks.join(''));
        }finally{reader.releaseLock();}
      }else payload = await response.json();
    }
    catch (error) {
      if(error?.name==='AbortError')throw error;
      throw new ApiError('响应未完整接收，请重新加载。',{status:0,path,code:'incomplete_response'});
    }
    if (!response.ok || payload?.ok === false) {
      throw new ApiError(payload?.message || `请求失败（${response.status}）`, {
        status: response.status,
        detail: payload,
        path,
        code: payload?.code || '',
      });
    }
    return payload;
  }
  if (!response.ok) {
    throw new ApiError(`请求失败（${response.status}）`, { status: response.status, path });
  }
  return response;
}

/**
 * Core request. Automatically attaches the session-bound CSRF token to
 * mutating verbs and refreshes it once if the server rejects a stale token.
 *
 * Concurrent identical GETs share a single network round trip, so several
 * regions on one page can each declare the data they need without the browser
 * issuing duplicate requests.
 */
const inflightGets = new Map();
const publicReads = createPublicReadCache();
// Tab memory only; never localStorage. Auth changes and every write invalidate it.
// 与服务端展示窗口一致：模块之间往返时直接复用，刷新与写入仍真实回源。
const managementReads = createPublicReadCache({ttlMs:30_000,maxAgeMs:30_000});
const activityCatalogReads = createPublicReadCache({ttlMs:30_000,maxAgeMs:30_000});
// 审批人路由属于配置读取：写入会立即失效，GET 展示可复用，避免每次进入重取。
const isManagementProjection=path=>/^\/api\/volunteer\/workflow(?:\/(?:catalog|workspace|sources|directory|approval-routing|events\/[^/]+\/detail))?(?:\?.*)?$/.test(path);
const isNotificationProjection=path=>path.split('?')[0]==='/api/notifications/overview';
function invalidateManagementReads(){managementReads.clear();activityCatalogReads.clear();for(const key of inflightGets.keys())if(isManagementProjection(key)||isNotificationProjection(key))inflightGets.delete(key);}
async function timedRead(path,options){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new DOMException('Read deadline exceeded','TimeoutError')),12_000);
 try{
  const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  for(let attempt=0;attempt<2;attempt++){
   const attemptController=new AbortController();
   // Leave a recovery window inside the existing overall deadline when a GET
   // receives headers but its body stalls. Writes never use this path.
   let attemptTimer;
   // The six-second timer measures inactivity, not total transfer duration.
   // Headers and body chunks reset it; the outer 12-second budget never moves.
   const progress=()=>{if(attempt===0){clearTimeout(attemptTimer);attemptTimer=setTimeout(()=>attemptController.abort(new DOMException('Read attempt stalled','TimeoutError')),6_000);}};
   progress();
   try{const result=await performRequest(path,{...options,onProgress:progress,signal:AbortSignal.any([signal,attemptController.signal])});signal.throwIfAborted();return result;}
   catch(error){if(attempt||signal.aborted||(!attemptController.signal.aborted&&(!(error instanceof ApiError)||![0,502,504].includes(error.status))))throw error;}
   finally{clearTimeout(attemptTimer);}
  }
 }
 catch(error){if(controller.signal.aborted&&!options.signal?.aborted)throw new ApiError('数据加载超时，请重试。',{status:408,path,code:'read_timeout'});throw error;}
 finally{clearTimeout(timer);}
}
const isPublicProjection = path => ['/api/public/events','/api/public/overview','/api/public/workflow/events','/api/public/warmth/capabilities'].includes(path.split('?')[0]);
export function peekPublicResponse(path) { return isPublicProjection(path) ? publicReads.peek(path) : null; }
function invalidatePublicReads(){publicReads.clear();for(const key of inflightGets.keys())if(isPublicProjection(key))inflightGets.delete(key);}

export async function request(path, options = {}) {
  const method = options.method || 'GET';
  if (method !== 'GET') {
    invalidatePublicReads();
    invalidateManagementReads();
    return performRequest(path, options).finally(()=>{invalidatePublicReads();invalidateManagementReads();});
  }
  // Abortable reads retain their caller's own cancellation rather than sharing.
  if(options.signal)return timedRead(path,options);
  if(isPublicProjection(path))return publicReads.get(path,()=>timedRead(path,options),{fresh:options.fresh});
  if(path==='/api/volunteer/workflow/catalog'&&hasPermission('events'))return activityCatalogReads.get(path,()=>timedRead(path,options),{fresh:options.fresh});
  if(isManagementProjection(path)&&hasPermission('events'))return managementReads.get(path,()=>timedRead(path,options),{fresh:options.fresh});
  if(isNotificationProjection(path)&&getSessionState().authenticated)return managementReads.get(path,()=>timedRead(path,options),{fresh:options.fresh});
  const existing = inflightGets.get(path);
  if (existing) return existing;
  const promise = timedRead(path, options).finally(() => inflightGets.delete(path));
  inflightGets.set(path, promise);
  return promise;
}

/**
 * 导航预取：鼠标或键盘焦点落到某个管理模块时，先把它的第一屏数据取回来。
 * 结果留在读缓存里，真正进入页面时的非 fresh 读取会直接命中；
 * 预取失败静默忽略，页面仍按正常路径加载。
 */
export function prefetchRead(path){
  if(!getSessionState().authenticated)return;
  void request(path).catch(()=>{});
}

export async function downloadFile(path, filename) {
  // Validate the session and approved records through the shared error boundary.
  // A native HTTP attachment also works in embedded browsers that reject blob downloads.
  await request(path, { method: 'HEAD' });
  const link = document.createElement('a');
  link.href = path;
  link.download = filename;
  link.dataset.native = 'true';
  document.body.append(link);
  link.click();
  link.remove();
}

async function performRequest(path, options = {}) {
  const start=performance.now(),clientTrace=globalThis.crypto?.randomUUID?.();
  let status=0,requestId=null,outcome='success';
  try{return await executeRequest(path,{...options,headers:{...options.headers,...(clientTrace?{'X-Client-Trace-ID':clientTrace}:{})},onResponse:response=>{status=response.status;requestId=response.headers.get('x-request-id');options.onProgress?.();}});}
  catch(error){outcome=options.signal?.aborted?(options.signal?.reason?.name==='TimeoutError'?'timeout':'aborted'):error?.code==='incomplete_response'?'incomplete':status?'http':'network';throw error;}
  finally{reportTiming({route:path,method:options.method||'GET',status,requestId,clientTrace,durationMs:performance.now()-start,outcome:outcome==='success'&&status>=400?'http':outcome});}
}

async function executeRequest(path, { method = 'GET', body, form, headers = {}, signal, retryCsrf = true, onResponse, onProgress } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, credentials: 'same-origin', signal };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD' && state.csrfToken) {
    init.headers['X-CSRF-Token'] = state.csrfToken;
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('网络连接中断，请检查网络后重试。', { status: 0, path, code: 'offline' });
  }

  const csrfRejected = response.status === 403 && retryCsrf && method !== 'GET'
    && (await response.clone().json().catch(() => null))?.code === 'csrf_failed';
  onResponse?.(response);
  if (csrfRejected) {
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed?.authenticated) {
      return performRequest(path, { method, body, form, headers, signal, retryCsrf: false });
    }
  }
  if (response.status === 401) {
    setSession(null);
  }
  return parse(response, path, onProgress);
}

/**
 * Binary request (zip download). Mirrors performRequest but resolves the raw
 * blob plus the Content-Disposition header, so callers can save it with a
 * server-chosen filename. Errors still surface as ApiError (JSON body).
 */
export async function requestBlob(path, { method = 'POST', body, headers = {}, retryCsrf = true } = {}) {
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD' && state.csrfToken) {
    init.headers['X-CSRF-Token'] = state.csrfToken;
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('网络连接中断，请检查网络后重试。', { status: 0, path, code: 'offline' });
  }
  if (response.status === 403 && retryCsrf) {
    const payload = await response.clone().json().catch(() => null);
    if (payload?.code === 'csrf_failed') {
      const refreshed = await refreshSession().catch(() => null);
      if (refreshed?.authenticated) return requestBlob(path, { method, body, headers, retryCsrf: false });
    }
  }
  if (response.status === 401) setSession(null);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(payload?.message || `请求失败（${response.status}）`, {
      status: response.status, path, code: payload?.code || 'request_failed', payload,
    });
  }
  const blob = await response.blob();
  return { blob, disposition: response.headers.get('Content-Disposition') || '' };
}

/* --------------------------------------------------------------------------
   Authentication
   -------------------------------------------------------------------------- */
export async function refreshSession() {
  const version = sessionVersion;
  const payload = await request('/api/auth/session');
  if (version !== sessionVersion) return { ok: true, ...getSessionState() };
  if (payload.authenticated) setSession(payload);
  else setSession(null);
  return payload;
}

export async function login(username, password) {
  const payload = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  setSession(payload);
  return payload;
}

/* --------------------------------------------------------------------------
   Identity: self-registration with e-mail verification (smail-bound)
   -------------------------------------------------------------------------- */
export async function getRegistrationConfig() {
  return request('/api/auth/registration-config');
}

export async function registerAccount(body) {
  return request('/api/auth/register', { method: 'POST', body });
}

export async function resendEmailCode(email, purpose = 'register') {
  return request('/api/auth/email-codes', { method: 'POST', body: { email, purpose } });
}

/** Verifying an e-mail signs the account in, so the session is adopted here. */
export async function verifyEmail(email, code, password) {
  const payload = await request('/api/auth/verify-email', { method: 'POST', body: { email, code, password } });
  setSession(payload);
  return payload;
}

export async function resetPassword(email, code, password) {
  const payload = await request('/api/auth/reset-password', { method: 'POST', body: { email, code, password } });
  setSession(null);
  return payload;
}

export async function sendPasswordChangeCode() {
  return request('/api/auth/change-password/code', {method:'POST',body:{}});
}

export async function changePassword(code, password) {
  const payload = await request('/api/auth/change-password', {method:'POST',body:{code,password}});
  setSession(null);
  return payload;
}

/** Private, short-lived memory only; never persisted in browser storage. */
export function peekAccountProfile() {
  if (!state.user || !profileCache || Date.now() - profileCache.at >= PROFILE_CACHE_MS) return null;
  return structuredClone(profileCache.payload);
}
export async function getAccountProfile() {
  const cached = peekAccountProfile();
  if (cached) return cached;
  if (!state.user) throw new ApiError('请先登录。', { status: 401 });
  if (profilePending) return structuredClone(await profilePending);
  const version = profileVersion;
  const pending = performRequest('/api/auth/account').then(payload => {
    if (version !== profileVersion || !state.user) throw new ApiError('登录状态已变更，请重新打开个人中心。', { code: 'profile_obsolete' });
    profileCache = { payload, at: Date.now() };
    return payload;
  }).finally(() => { if (profilePending === pending) profilePending = null; });
  profilePending = pending;
  return structuredClone(await pending);
}
export async function updateAccountProfile(body) {
  clearProfileCache();
  const version = profileVersion;
  const payload = await request('/api/auth/account', {method:'PATCH',body});
  if (version !== profileVersion || !state.user) throw new ApiError('登录状态已变更。', { code: 'profile_obsolete' });
  // The PATCH already returns the synchronized profile; avoid a second sync GET.
  profileCache = { payload, at: Date.now() };
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('account-profile-updated'));
  return payload;
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    setSession(null);
  }
}

/* --------------------------------------------------------------------------
   Console (authenticated) surface
   -------------------------------------------------------------------------- */
export const console_ = {
  search: (query) => {
    const params = new URLSearchParams({ q: query });
    return request(`/api/console/search?${params.toString()}`);
  },
  morning: {
    cards: ({ status = '', q = '' } = {}) => {
      const search = new URLSearchParams();
      if (status) search.set('status', status);
      if (q) search.set('q', q);
      const query = search.toString();
      return request(`/api/community/morning/cards${query ? `?${query}` : ''}`);
    },
    card: (id) => request(`/api/community/morning/cards/${encodeURIComponent(id)}`),
    review: (id, body) => request(`/api/community/morning/cards/${encodeURIComponent(id)}/review`, { method: 'POST', body }),
    reports: ({ status = '' } = {}) => {
      const query = status ? `?status=${encodeURIComponent(status)}` : '';
      return request(`/api/community/morning/reports${query}`);
    },
    decideReport: (id, action, body) => request(`/api/community/morning/reports/${encodeURIComponent(id)}/${action}`, { method: 'POST', body }),
    members: () => request('/api/community/morning/members'),
    blacklist: ({ status = '' } = {}) => {
      const query = status ? `?status=${encodeURIComponent(status)}` : '';
      return request(`/api/community/morning/blacklist${query}`);
    },
    blacklistAccount: (body) => request('/api/community/morning/blacklist', { method: 'POST', body }),
    releaseBlacklist: (id) => request(`/api/community/morning/blacklist/${encodeURIComponent(id)}/release`, { method: 'POST', body: {} }),
  },

  health: ({ summary = false } = {}) => request(summary ? '/api/health?summary=true' : '/api/health'),
  notifications: (options = {}) => request('/api/notifications/overview', options),
  audit: (limit = 60) => request(`/api/audit/recent?limit=${encodeURIComponent(limit)}`),

  materials: {
    overview: (options = {}) => request('/api/materials/overview', options),
    scan: (code) => request(`/api/materials/scan?code=${encodeURIComponent(code)}`),
    qrUrl: (id) => `/api/materials/inventory/${encodeURIComponent(id)}/qr`,
    createApplication: (body) => request('/api/materials/applications', { method: 'POST', body }),
    approve: (id) => request(`/api/materials/applications/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} }),
    reject: (id, reason) => request(`/api/materials/applications/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } }),
    checkout: (id, form) => request(`/api/materials/applications/${encodeURIComponent(id)}/checkout`, { method: 'POST', form }),
    returnItems: (id, form) => request(`/api/materials/applications/${encodeURIComponent(id)}/return`, { method: 'POST', form }),
    transaction: (body) => request('/api/materials/transactions', { method: 'POST', body }),
    schema: () => request('/api/materials/schema'),
    updateInventory: (id, body) => request(`/api/materials/inventory/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    createInventoryDemo: (body) => request('/api/preview/materials/inventory', { method: 'POST', body }),
    movementDemo: (form) => request('/api/preview/materials/movements', { method: 'POST', form }),
    updateAvailabilityDemo: (id, body) => request(`/api/preview/materials/inventory/${encodeURIComponent(id)}/availability`, { method: 'PATCH', body }),
    flows: (filters = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== null && value !== undefined) query.set(key, String(value));
      return request(`/api/materials/flows?${query}`);
    },
    retrySync: (id) => request(`/api/materials/flows/${encodeURIComponent(id)}/retry-sync`, { method: 'POST', body: {} }),
    reviewFlow: (id, note) => request(`/api/materials/flows/${encodeURIComponent(id)}/review`, { method: 'PATCH', body: { note } }),
  },

  events: {
    overview: (options = {}) => request('/api/events/overview', options),
    schemaPreview: () => request('/api/events/schema-preview'),
    create: (body) => request('/api/events', { method: 'POST', body }),
    addSession: (eventId, body) => request(`/api/events/${encodeURIComponent(eventId)}/sessions`, { method: 'POST', body }),
    publish: (eventId) => request(`/api/events/${encodeURIComponent(eventId)}/publish`, { method: 'POST', body: {} }),
    close: (eventId) => request(`/api/events/${encodeURIComponent(eventId)}/close`, { method: 'POST', body: {} }),
    register: (eventId, body) => request(`/api/events/${encodeURIComponent(eventId)}/registrations`, { method: 'POST', body }),
    cancel: (registrationId) => request(`/api/events/registrations/${encodeURIComponent(registrationId)}/cancel`, { method: 'POST', body: {} }),
    checkIn: (registrationId, token) => request(`/api/events/registrations/${encodeURIComponent(registrationId)}/check-in`, { method: 'POST', body: { token } }),
  },

  notices: {
    list: (eventId) => request(`/api/event-notices${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`),
    preview: (body) => request('/api/event-notices/preview', { method: 'POST', body }),
    create: (body) => request('/api/event-notices', { method: 'POST', body }),
    publish: (noticeId) => request(`/api/event-notices/${encodeURIComponent(noticeId)}/publish`, { method: 'POST', body: {} }),
    archive: (noticeId) => request(`/api/event-notices/${encodeURIComponent(noticeId)}/archive`, { method: 'POST', body: {} }),
  },

  attachments: {
    list: (eventId) => request(`/api/event-attachments${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`),
    njuboxStatus: () => request('/api/event-attachments/njubox-status'),
    upload: (form) => request('/api/event-attachments', { method: 'POST', form }),
    reference: (body) => request('/api/event-attachments', { method: 'POST', body }),
  },

  volunteer: {
    overview: (options = {}) => request('/api/volunteer/overview', options),
    hoursPreview: (registrationIds, exportConfigId) => request('/api/volunteer/hours-preview', { method: 'POST', body: { registrationIds, ...(exportConfigId ? { exportConfigId } : {}) } }),
  },

  outreach: {
    overview: (options = {}) => request('/api/outreach/overview', options),
    schemaPreview: () => request('/api/outreach/schema-preview'),
    review: (contentId, body) => request(`/api/outreach/reviews/${encodeURIComponent(contentId)}`, { method: 'POST', body }),
    schedule: (contentId, body) => request(`/api/outreach/publications/${encodeURIComponent(contentId)}/schedule`, { method: 'POST', body }),
    result: (contentId, body) => request(`/api/outreach/publications/${encodeURIComponent(contentId)}/result`, { method: 'POST', body }),
    publicSubmissions: () => request('/api/outreach/public-submissions'),
    submissionAttachments: (id) => request(`/api/outreach/public-submissions/${encodeURIComponent(id)}/attachments`),
    // v3 多级审核工作流（按栏目选人 / 清单 / 审核链 / 逐级推进 / 意见 Word）
    assignees: (category = '') => request(`/api/outreach/assignees${category ? `?category=${encodeURIComponent(category)}` : ''}`),
    checklist: () => request('/api/outreach/checklist'),
    reviewChain: (contentId) => request(`/api/outreach/reviews/${encodeURIComponent(contentId)}/chain`),
    reviewStep: (contentId, body) => request(`/api/outreach/reviews/${encodeURIComponent(contentId)}/step`, { method: 'POST', body }),
    // 意见 Word：走 requestBlob 以自动注入会话 CSRF（不可用裸 fetch 读 meta[name="csrf-token"]
    // ——该标签从未被注入，token 会是空串，导致 403 csrf_failed）。
    opinion: (contentId, body) => requestBlob(`/api/outreach/reviews/${encodeURIComponent(contentId)}/opinion`, { method: 'POST', body }),
  },

  community: {
    overview: (options = {}) => request('/api/community/overview', options),
    matchingPreview: () => request('/api/community/matching-preview'),
    submissions: () => request('/api/community/submissions'),
    submit: (body) => request('/api/community/submissions', { method: 'POST', body }),
    reviewSubmission: (id, body) => request(`/api/community/submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body }),
    consent: (body) => request('/api/community/consent', { method: 'POST', body }),
    withdraw: (program) => request(`/api/community/consent/${encodeURIComponent(program)}/withdraw`, { method: 'POST', body: {} }),
    interests: () => request('/api/community/interests'),
    warmthReports: () => request('/api/community/warmth-reports'),
    decideWarmthReport: (id, action, body) => request(`/api/community/warmth-reports/${encodeURIComponent(id)}/${action}`, { method: 'POST', body }),
    decideInterest: (id, action) => request(`/api/community/interests/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} }),
    kickInterest: (id) => request(`/api/community/interests/${encodeURIComponent(id)}/kick`, { method: 'POST', body: {} }),
    blacklistInterest: (id, body) => request(`/api/community/interests/${encodeURIComponent(id)}/blacklist`, { method: 'POST', body }),
    warmthBlacklist: () => request('/api/community/warmth-blacklist'),
    warmthMember: (ref) => request(`/api/community/warmth-members/${encodeURIComponent(ref)}`),
    blessingLibrary: () => request('/api/community/blessing-library'),
    blacklistParticipant: (body) => request('/api/community/warmth-blacklist', { method: 'POST', body }),
    releaseBlacklist: (id) => request(`/api/community/warmth-blacklist/${encodeURIComponent(id)}/release`, { method: 'POST', body: {} }),
    releaseBlacklistByRef: (body) => request('/api/community/warmth-blacklist/release', { method: 'POST', body }),
  },

  // v3 S5 任务与技能（控制台）
  tasks: {
    publish: (body) => request('/api/console/tasks', { method: 'POST', body }),
    // v3.1：任务申领审核队列与审核
    claims: () => request('/api/console/tasks/claims'),
    reviewClaim: (claimId, body) => request(`/api/console/tasks/claims/${encodeURIComponent(claimId)}/review`, { method: 'POST', body }),
  },
  skills: {
    queue: () => request('/api/console/skills'),
    review: (skillId, body) => request(`/api/console/skills/${encodeURIComponent(skillId)}/review`, { method: 'POST', body }),
  },

  // v3 N1 影像审核（控制台）：精选确认队列 + 删除审核队列。
  media: {
    picksQueue: () => request('/api/console/media/picks'),
    pickConfirm: (ids) => request('/api/console/media/picks/confirm', { method: 'POST', body: { ids } }),
    deleteQueue: () => request('/api/console/media/deletes'),
    deleteReview: (photoId, decision) => request(`/api/console/media/${encodeURIComponent(photoId)}/delete-review`, { method: 'POST', body: { decision } }),
  },

  // v3 S7 宣传展示维护（控制台）：半自动导入 + 列表管理。
  showcase: {
    items: () => request('/api/console/showcase/items'),
    extract: (body) => request('/api/console/showcase/extract', { method: 'POST', body }),
    // 抓取被公众号反爬拦下时的手动补全：标题 + 封面图地址照样落库。
    manual: (body) => request('/api/console/showcase/manual', { method: 'POST', body }),
    update: (itemId, patch) => request(`/api/console/showcase/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: patch }),
    remove: (itemId) => request(`/api/console/showcase/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  },

  data: {
    rows: (table) => request(`/api/rows?table=${encodeURIComponent(table)}`),
    appendRow: (table, row) => request('/api/rows', { method: 'POST', body: { table, row } }),
    updateRow: (table, rowId, row) => request(`/api/rows/${encodeURIComponent(rowId)}`, { method: 'PUT', body: { table, row } }),
    deleteRow: (table, rowId) => request(`/api/rows/${encodeURIComponent(rowId)}?table=${encodeURIComponent(table)}`, { method: 'DELETE' }),
  },

  state: {
    schemaPreview: () => request('/api/state/schema-preview'),
  },
};

/* --------------------------------------------------------------------------
   Public (unauthenticated reads, login-gated writes) surface
   -------------------------------------------------------------------------- */
export const portal = {
  me: () => request('/api/portal/me'),
  warmthState: () => request('/api/portal/me?view=warmth'),
};

export const morningApi = {
  card: () => request('/api/morning/card'),
  plaza: ({ page = 1, q = '' } = {}) => {
    const search = new URLSearchParams({ page: String(Math.max(1, Number(page) || 1)) });
    if (q) search.set('q', q);
    return request(`/api/morning/cards?${search.toString()}`);
  },
  plazaCard: (id) => request(`/api/morning/cards/${encodeURIComponent(id)}`),
  tags: () => request('/api/morning/tags'),
  createTag: (tag) => request('/api/morning/tags', { method: 'POST', body: { tag } }),
  comments: (id) => request(`/api/morning/cards/${encodeURIComponent(id)}/comments`),
  createComment: (id, body) => request(`/api/morning/cards/${encodeURIComponent(id)}/comments`, { method: 'POST', body }),
  reportComment: (cardId, commentId, body) => request(`/api/morning/cards/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}/report`, { method: 'POST', body }),
  submitCard: (body) => request('/api/morning/card', { method: 'POST', body }),
  withdrawCard: () => request('/api/morning/card/withdraw', { method: 'POST', body: {} }),
};

export const publicApi = {
  craneMessages: () => request('/api/public/cranes'),
  submitCraneMessage: body => request('/api/public/cranes', { method: 'POST', body }),
  overview: () => request('/api/public/overview'),
  // v3 第 3/12 项：笔名绑定（GET 读状态 / POST 首次绑定）。
  penName: () => request('/api/portal/pen-name'),
  bindPenName: (penName) => request('/api/portal/pen-name', { method: 'POST', body: { penName } }),
  // v3 第 5/15 项：文创类型/栏目/展示分类字典下发。
  writingTypes: () => request('/api/public/writing-types'),
  events: (params = {}, options = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.campus) search.set('campus', params.campus);
    if (params.q) search.set('q', params.q);
    const query = search.toString();
    return request(`/api/public/events${query ? `?${query}` : ''}`,options);
  },
  event: (eventId) => request(`/api/public/events/${encodeURIComponent(eventId)}`),
  register: (eventId, body) => request(`/api/public/events/${encodeURIComponent(eventId)}/registrations`, { method: 'POST', body }),
  lookup: (body) => request('/api/public/registrations/lookup', { method: 'POST', body }),
  materialRequest: (body) => request('/api/public/materials/requests', { method: 'POST', body }),
  // v2：文字稿件（实名）与文创设计（笔名匿名）分端点提交。
  submissionArticle: (body) => request('/api/public/submissions/article', { method: 'POST', body }),
  submissionDesign: (body) => request('/api/public/submissions/design', { method: 'POST', body }),
  attachmentSlot: (body) => request('/api/public/attachments', { method: 'POST', body }),
  myAttachments: () => request('/api/public/attachments/mine'),
  attachmentDelete: (attachmentId) => request(`/api/public/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }),
  warmthInterest: (body) => request('/api/public/warmth/interest', { method: 'POST', body }),

  materialCatalog: () => request('/api/public/materials/catalog'),
  materialBorrowEligibility: () => request('/api/public/materials/borrow-eligibility'),
  materialLoans: () => request('/api/public/materials/loans'),
  materialReturn: form => request('/api/public/materials/returns', { method: 'POST', form }),
  materialReturnsMine: () => request('/api/public/materials/returns'),
  reimbursements: () => request(getSessionState().user?.localPreview === true ? '/api/preview/reimbursements/mine' : '/api/reimbursements/mine'),
  reimbursementCreate: body => request(getSessionState().user?.localPreview === true ? '/api/preview/reimbursements' : '/api/reimbursements', { method: 'POST', body }),

  // v2 影像模块：中心+活动候选、上传、直链、留用、删除、批量更名。
  // v3 第 16 项：mediaActivities 支持 ?center= 过滤（先选中心 → 活动下拉联动）。
  mediaActivities: ({ center = '' } = {}) => request(`/api/public/media/activities${center ? `?center=${encodeURIComponent(center)}` : ''}`),
  myPhotos: ({ center = '', activity = '', showPicked = false } = {}) => {
    const params = new URLSearchParams();
    if (center) params.set('center', center);
    if (activity) params.set('activity', activity);
    if (showPicked) params.set('showPicked', '1');
    const qs = params.toString();
    return request(`/api/public/media${qs ? `?${qs}` : ''}`);
  },
  mediaLink: (photoId) => request(`/api/public/media/${encodeURIComponent(photoId)}/link`),
  mediaKeep: (photoId, keep) => request(`/api/public/media/${encodeURIComponent(photoId)}`, { method: 'PATCH', body: { keep } }),
  mediaDelete: (photoId) => request(`/api/public/media/${encodeURIComponent(photoId)}`, { method: 'DELETE' }),
  mediaBatchRename: (ids) => request('/api/public/media/batch-rename', { method: 'POST', body: { ids } }),
  // v3 N1 双库精选（复制模式）+ 删除审核 + 批量下载
  mediaPickRequest: (ids) => request('/api/public/media/picks', { method: 'POST', body: { ids } }),
  myPicks: () => request('/api/public/media/picks'),
  mediaDeleteRequest: (photoId, reason) => request(`/api/public/media/${encodeURIComponent(photoId)}/delete-request`, { method: 'POST', body: { reason } }),
  // 批量下载：服务端打 zip，返回 { blob, disposition }。
  // 不能走 <a href> 提交（CSP form-action 'self' 且要带 CSRF），故用 fetch + blob 下载。
  mediaDownloadZip: (ids) => requestBlob('/api/public/media/download-zip', { method: 'POST', body: { ids } }),
  // v3 S5 任务申领（心愿清单）
  tasks: () => request('/api/public/tasks'),
  myClaims: () => request('/api/public/tasks/mine'),
  claimTask: (taskId, note = '') => request(`/api/public/tasks/${encodeURIComponent(taskId)}/claim`, { method: 'POST', body: { note } }),
  // v3 S5 会员技能（提交 + 查看本人）
  mySkills: () => request('/api/portal/skills'),
  submitSkill: (body) => request('/api/portal/skills', { method: 'POST', body }),
  // v2 宣传展示板块：公开卡片流。
  showcaseFeed: () => request('/api/public/showcase'),
  // main：温暖连接（生日祝福 / 早安晚安）公开接口。
  warmthBlessing: (body) => request('/api/public/warmth/blessings', { method: 'POST', body }),
  myWarmthBlessings: () => request('/api/public/warmth/blessings/mine'),
  deliveredWarmthBlessings: () => request('/api/public/warmth/blessings/delivered'),
  sentWarmthBlessings: () => request('/api/public/warmth/blessings/sent'),
  reportWarmthBlessing: (id, body) => request(`/api/public/warmth/blessings/${encodeURIComponent(id)}/report`, { method: 'POST', body }),
  acknowledgeWarmthReport: (id) => request(`/api/public/warmth/reports/${encodeURIComponent(id)}/acknowledge`, { method: 'POST', body: {} }),
  resubmitWarmthBlessing: (id, body) => request(`/api/public/warmth/blessings/${encodeURIComponent(id)}/resubmit`, { method: 'POST', body }),
  deleteWarmthBlessing: (id) => request(`/api/public/warmth/blessings/${encodeURIComponent(id)}/delete`, { method: 'POST', body: {} }),
  withdrawWarmthInterest: (id) => request(`/api/public/warmth/interests/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: {} }),
  updateWarmthInterest: (id, body) => request(`/api/public/warmth/interests/${encodeURIComponent(id)}/update`, { method: 'POST', body }),
};

/**
 * Attachment relay upload. Uses XHR instead of fetch for one reason only:
 * upload progress events, which matter once videos (≤200MB) enter the flow.
 * The request still targets this origin (server relays bytes to OSS), so the
 * CSP stays locked to connect-src 'self'.
 */
export function uploadAttachment(attachmentId, file, { onProgress = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const path = `/api/public/attachments/${encodeURIComponent(attachmentId)}`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
    const form = new FormData();
    form.append('file', file, file.name);
    const onUploadProgress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };
    const onAbort = () => reject(new ApiError('上传已取消。', { status: 0, path, code: 'aborted' }));
    xhr.upload.addEventListener('progress', onUploadProgress);
    xhr.addEventListener('abort', onAbort);
    xhr.addEventListener('error', () => reject(new ApiError('网络连接中断，请检查网络后重试。', { status: 0, path, code: 'offline' })));
    xhr.addEventListener('load', () => {
      let payload = null;
      try { payload = JSON.parse(xhr.responseText); } catch { payload = null; }
      if (xhr.status >= 200 && xhr.status < 300 && payload?.ok) {
        resolve(payload);
        return;
      }
      if (xhr.status === 401) setSession(null);
      reject(new ApiError(payload?.message || `上传失败（${xhr.status}）`, {
        status: xhr.status,
        detail: payload,
        path,
        code: payload?.code || '',
      }));
    });
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/**
 * v2 影像模块批量上传（multipart：center + activity + files 多值）。与
 * uploadAttachment 同样走本源中转（服务端转存 NJU Box），CSP 不变。
 * 摄影师名由服务端从账号实名强制取，前端不传。
 */
export function mediaUpload({ center, activity, files, onProgress = null, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    const path = '/api/public/media';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    if (state.csrfToken) xhr.setRequestHeader('X-CSRF-Token', state.csrfToken);
    const form = new FormData();
    form.append('center', center);
    form.append('activity', activity);
    let total = 0;
    for (const file of files) {
      form.append('files', file, file.name);
      total += file.size || 0;
    }
    let loaded = 0;
    const onUploadProgress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      } else if (total && typeof onProgress === 'function') {
        // 分批上传时逐文件累计进度。
        onProgress(Math.min(100, Math.round((loaded / total) * 100)));
      }
    };
    const onAbort = () => reject(new ApiError('上传已取消。', { status: 0, path, code: 'aborted' }));
    xhr.upload.addEventListener('progress', onUploadProgress);
    xhr.addEventListener('abort', onAbort);
    xhr.addEventListener('error', () => reject(new ApiError('网络连接中断，请检查网络后重试。', { status: 0, path, code: 'offline' })));
    xhr.addEventListener('load', () => {
      let payload = null;
      try { payload = JSON.parse(xhr.responseText); } catch { payload = null; }
      // 单张失败不否定整批：payload.ok=false 且带 failed 明细时仍走 resolve。
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        resolve(payload);
        return;
      }
      if (xhr.status === 401) setSession(null);
      reject(new ApiError(payload?.message || `上传失败（${xhr.status}）`, {
        status: xhr.status,
        detail: payload,
        path,
        code: payload?.code || '',
      }));
    });
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

export { console_ as consoleApi };
