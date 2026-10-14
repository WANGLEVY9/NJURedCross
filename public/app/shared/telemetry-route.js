// Closed vocabulary: never retain query strings, filenames, record IDs or user text.
const words = new Set(('api auth login logout session register verify-email portal public console volunteer workflow catalog detail events registrations hours sources directory metadata health overview accounts profile me materials outreach community notifications skills tasks claims submissions messages interests matching-preview rows tables schema-preview approve publish confirm checkin-review checkin review post stop submit archive restore close reject revoke-confirmation leave-approve leave-reject positions mail-status notify-results batch roster attendance photo wishlist warmth birthday morning capabilities telemetry client timings').split(' '));
export function telemetryRoute(path) {
  const clean=String(path||'').split(/[?#]/,1)[0];
  if(!clean.startsWith('/')||clean.length>1024)return '/:other';
  if(/\.(?:js|css|woff2?|png|svg|ico|jpg|webp)$/.test(clean))return '/:asset';
  return '/'+clean.split('/').filter(Boolean).slice(0,8).map(part=>words.has(part)?part:':id').join('/');
}
