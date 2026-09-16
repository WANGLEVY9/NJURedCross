/* ==========================================================================
   store.js — minimal reactive state + a stale-while-revalidate resource cache.
   Enables progressive loading (structure first, data second) and optimistic UI
   with rollback, without pulling in a framework.
   ========================================================================== */

export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();

  const notify = (changed) => {
    for (const listener of [...listeners]) listener(state, changed);
  };

  return {
    get() {
      return state;
    },
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      const changed = Object.keys(next).filter((key) => next[key] !== state[key]);
      if (!changed.length) return state;
      state = { ...state, ...next };
      notify(changed);
      return state;
    },
    subscribe(listener, { immediate = false } = {}) {
      listeners.add(listener);
      if (immediate) listener(state, Object.keys(state));
      return () => listeners.delete(listener);
    },
    /** Subscribe to a single key and receive only its value. */
    select(key, listener, { immediate = true } = {}) {
      const wrapped = (next, changed) => {
        if (changed.includes(key)) listener(next[key]);
      };
      listeners.add(wrapped);
      if (immediate) listener(state[key]);
      return () => listeners.delete(wrapped);
    },
  };
}

/* --------------------------------------------------------------------------
   Resource — one loader, many consumers, shared in-flight promise
   -------------------------------------------------------------------------- */

const STALE_AFTER = 30_000;

export function createResource(loader, { key = 'resource', staleAfter = STALE_AFTER } = {}) {
  let value = null;
  let error = null;
  let loadedAt = 0;
  let inflight = null;
  const listeners = new Set();

  const snapshot = () => ({
    key,
    data: value,
    error,
    loading: Boolean(inflight),
    loadedAt,
    stale: !loadedAt || Date.now() - loadedAt > staleAfter,
    hasData: value !== null,
  });

  const notify = () => {
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  async function run(...args) {
    if (inflight) return inflight;
    notify();
    inflight = (async () => {
      try {
        value = await loader(...args);
        error = null;
        loadedAt = Date.now();
        return value;
      } catch (caught) {
        error = caught;
        throw caught;
      } finally {
        inflight = null;
        notify();
      }
    })();
    return inflight;
  }

  return {
    snapshot,
    subscribe(listener, { immediate = true } = {}) {
      listeners.add(listener);
      if (immediate) listener(snapshot());
      return () => listeners.delete(listener);
    },
    /** Returns cached data immediately when fresh; revalidates when stale. */
    async read({ force = false } = {}) {
      if (!force && value !== null && Date.now() - loadedAt <= staleAfter) return value;
      return run();
    },
    async refresh() {
      return run();
    },
    /** Applies an optimistic patch and returns a rollback function. */
    mutate(patch) {
      const previous = value;
      value = typeof patch === 'function' ? patch(value) : patch;
      notify();
      return () => {
        value = previous;
        notify();
      };
    },
    invalidate() {
      loadedAt = 0;
    },
    peek() {
      return value;
    },
  };
}

/**
 * Runs an optimistic write: applies the local patch, calls the server, then
 * either keeps the change or rolls it back with an explanation.
 */
export async function optimistic(resource, patch, action, { onError } = {}) {
  const rollback = resource.mutate(patch);
  try {
    const result = await action();
    return result;
  } catch (error) {
    rollback();
    if (onError) onError(error);
    throw error;
  }
}

/* --------------------------------------------------------------------------
   Session-scoped preferences (density, nav state, last used filters)
   -------------------------------------------------------------------------- */

const PREF_KEY = 'nju-rc.preferences.v1';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch {
    return {};
  }
}

export const prefs = {
  get(key, fallback = null) {
    const all = readPrefs();
    return key in all ? all[key] : fallback;
  },
  set(key, value) {
    const all = readPrefs();
    all[key] = value;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable — preferences degrade to per-session defaults */
    }
    return value;
  },
};
