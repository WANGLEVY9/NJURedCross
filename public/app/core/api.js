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

function setSession(payload) {
  state.csrfToken = payload?.csrfToken || null;
  state.user = payload?.user || null;
  state.expiresAt = payload?.expiresAt || null;
  emitSession();
}

async function parse(response, path) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new ApiError(payload?.message || `请求失败（${response.status}）`, {
        status: response.status,
        detail: payload,
        path,
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

export async function request(path, options = {}) {
  const method = options.method || 'GET';
  if (method !== 'GET') return performRequest(path, options);
  const existing = inflightGets.get(path);
  if (existing) return existing;
  const promise = performRequest(path, options).finally(() => inflightGets.delete(path));
  inflightGets.set(path, promise);
  return promise;
}

async function performRequest(path, { method = 'GET', body, form, headers = {}, signal, retryCsrf = true } = {}) {
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

  if (response.status === 403 && retryCsrf && method !== 'GET') {
    const refreshed = await refreshSession().catch(() => null);
    if (refreshed?.authenticated) {
      return performRequest(path, { method, body, form, headers, signal, retryCsrf: false });
    }
  }
  if (response.status === 401) {
    setSession(null);
  }
  return parse(response, path);
}

/* --------------------------------------------------------------------------
   Authentication
   -------------------------------------------------------------------------- */
export async function refreshSession() {
  const payload = await request('/api/auth/session');
  if (payload.authenticated) setSession(payload);
  else setSession(null);
  return payload;
}

export async function login(username, password) {
  const payload = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  setSession(payload);
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
  health: () => request('/api/health'),
  notifications: () => request('/api/notifications/overview'),
  audit: (limit = 60) => request(`/api/audit/recent?limit=${encodeURIComponent(limit)}`),

  materials: {
    overview: () => request('/api/materials/overview'),
    scan: (code) => request(`/api/materials/scan?code=${encodeURIComponent(code)}`),
    qrUrl: (id) => `/api/materials/inventory/${encodeURIComponent(id)}/qr`,
    createApplication: (body) => request('/api/materials/applications', { method: 'POST', body }),
    approve: (id) => request(`/api/materials/applications/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} }),
    reject: (id, reason) => request(`/api/materials/applications/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } }),
    checkout: (id, form) => request(`/api/materials/applications/${encodeURIComponent(id)}/checkout`, { method: 'POST', form }),
    returnItems: (id, form) => request(`/api/materials/applications/${encodeURIComponent(id)}/return`, { method: 'POST', form }),
    transaction: (body) => request('/api/materials/transactions', { method: 'POST', body }),
  },

  events: {
    overview: () => request('/api/events/overview'),
    schemaPreview: () => request('/api/events/schema-preview'),
    create: (body) => request('/api/events', { method: 'POST', body }),
    addSession: (eventId, body) => request(`/api/events/${encodeURIComponent(eventId)}/sessions`, { method: 'POST', body }),
    publish: (eventId) => request(`/api/events/${encodeURIComponent(eventId)}/publish`, { method: 'POST', body: {} }),
    close: (eventId) => request(`/api/events/${encodeURIComponent(eventId)}/close`, { method: 'POST', body: {} }),
    register: (eventId, body) => request(`/api/events/${encodeURIComponent(eventId)}/registrations`, { method: 'POST', body }),
    cancel: (registrationId) => request(`/api/events/registrations/${encodeURIComponent(registrationId)}/cancel`, { method: 'POST', body: {} }),
    checkIn: (registrationId, token) => request(`/api/events/registrations/${encodeURIComponent(registrationId)}/check-in`, { method: 'POST', body: { token } }),
  },

  volunteer: {
    overview: () => request('/api/volunteer/overview'),
  },

  outreach: {
    overview: () => request('/api/outreach/overview'),
    schemaPreview: () => request('/api/outreach/schema-preview'),
    review: (contentId, body) => request(`/api/outreach/reviews/${encodeURIComponent(contentId)}`, { method: 'POST', body }),
    schedule: (contentId, body) => request(`/api/outreach/publications/${encodeURIComponent(contentId)}/schedule`, { method: 'POST', body }),
    result: (contentId, body) => request(`/api/outreach/publications/${encodeURIComponent(contentId)}/result`, { method: 'POST', body }),
    publicSubmissions: () => request('/api/outreach/public-submissions'),
    reviewPublicSubmission: (id, body) => request(`/api/outreach/public-submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body }),
  },

  community: {
    overview: () => request('/api/community/overview'),
    matchingPreview: () => request('/api/community/matching-preview'),
    submissions: () => request('/api/community/submissions'),
    submit: (body) => request('/api/community/submissions', { method: 'POST', body }),
    reviewSubmission: (id, body) => request(`/api/community/submissions/${encodeURIComponent(id)}/review`, { method: 'POST', body }),
    consent: (body) => request('/api/community/consent', { method: 'POST', body }),
    withdraw: (program) => request(`/api/community/consent/${encodeURIComponent(program)}/withdraw`, { method: 'POST', body: {} }),
    interests: () => request('/api/community/interests'),
    decideInterest: (id, action) => request(`/api/community/interests/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: {} }),
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
};

export const publicApi = {
  overview: () => request('/api/public/overview'),
  events: (params = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.campus) search.set('campus', params.campus);
    if (params.q) search.set('q', params.q);
    const query = search.toString();
    return request(`/api/public/events${query ? `?${query}` : ''}`);
  },
  event: (eventId) => request(`/api/public/events/${encodeURIComponent(eventId)}`),
  register: (eventId, body) => request(`/api/public/events/${encodeURIComponent(eventId)}/registrations`, { method: 'POST', body }),
  lookup: (body) => request('/api/public/registrations/lookup', { method: 'POST', body }),
  materialRequest: (body) => request('/api/public/materials/requests', { method: 'POST', body }),
  submission: (body) => request('/api/public/submissions', { method: 'POST', body }),
  warmthInterest: (body) => request('/api/public/warmth/interest', { method: 'POST', body }),
};

export { console_ as consoleApi };
