/** Keep the SDK's short-lived Base access token fresh in a long-running server. */

export function accessTokenExpiresAt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function createSeaTableAccess(base, {
  now = Date.now,
  maxAgeMs = 6 * 60 * 60 * 1000,
  refreshBeforeMs = 5 * 60 * 1000,
} = {}) {
  let authenticated = false;
  let refreshAt = 0;
  let inFlight = null;

  return async function getBase() {
    if (authenticated && now() < refreshAt) return base;
    if (!inFlight) {
      inFlight = (async () => {
        await base.auth();
        const authenticatedAt = now();
        const expiresAt = accessTokenExpiresAt(base.accessToken);
        if (expiresAt !== null && expiresAt <= authenticatedAt + refreshBeforeMs) {
          throw new Error('SeaTable returned an expired or near-expiry access token');
        }
        refreshAt = Math.min(
          authenticatedAt + maxAgeMs,
          expiresAt === null ? Infinity : expiresAt - refreshBeforeMs,
        );
        authenticated = true;
      })().finally(() => { inFlight = null; });
    }
    await inFlight;
    return base;
  };
}
