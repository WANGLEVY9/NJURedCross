const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

const pages = ['/', '/events', '/materials', '/submit', '/warmth', '/status', '/about', '/console/login'];
const assets = ['/app/main.js', '/styles/tokens.css', '/styles/base.css', '/styles/components.css', '/styles/portal.css', '/styles/admin.css'];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body, contentType };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function checkPage(path) {
  const { response, body, contentType } = await request(path);
  assert(response.status === 200, `${path} returned ${response.status}`);
  assert(contentType.includes('text/html'), `${path} did not return HTML`);
  assert(body.includes('id="root"'), `${path} is missing the application root`);
  assert(response.headers.get('content-security-policy')?.includes("script-src 'self'"), `${path} is missing the self-only script CSP`);
  assert(response.headers.get('x-frame-options') === 'DENY', `${path} is missing clickjacking protection`);
  return `${response.status} ${path}`;
}

async function checkAsset(path) {
  const { response, body } = await request(path);
  assert(response.status === 200, `${path} returned ${response.status}`);
  assert(String(body).length > 50, `${path} appears empty`);
  return `${response.status} ${path}`;
}

async function checkPublicApi(path, validate) {
  const { response, body, contentType } = await request(path);
  assert(response.status === 200, `${path} returned ${response.status}`);
  assert(contentType.includes('application/json'), `${path} did not return JSON`);
  assert(body?.ok === true, `${path} did not return ok=true`);
  validate(body);
  return `${response.status} ${path}`;
}

const results = [];
for (const path of pages) results.push(await checkPage(path));
for (const path of assets) results.push(await checkAsset(path));

results.push(await checkPublicApi('/api/public/overview', (body) => {
  assert(body.stats && Number.isFinite(body.stats.openEvents), 'public overview is missing numeric openEvents');
  assert(Array.isArray(body.featured), 'public overview is missing featured events');
  assert(Array.isArray(body.programs), 'public overview is missing service programs');
}));

results.push(await checkPublicApi('/api/public/events', (body) => {
  assert(body.stats && Number.isFinite(body.stats.total), 'public events is missing numeric total');
  assert(Array.isArray(body.events), 'public events is missing the events array');
  assert(Array.isArray(body.facets?.campuses), 'public events is missing campus facets');
}));

const missingEvent = await request('/api/public/events/SMOKE-NOT-FOUND');
assert(missingEvent.response.status === 404, `missing public event returned ${missingEvent.response.status}`);
assert(missingEvent.body?.ok === false, 'missing public event did not return ok=false');
results.push('404 /api/public/events/SMOKE-NOT-FOUND');

const protectedHealth = await request('/api/health');
assert(protectedHealth.response.status === 401, `unauthenticated /api/health returned ${protectedHealth.response.status}`);
results.push('401 /api/health (unauthenticated boundary)');

console.log(`Public smoke check passed against ${baseUrl}`);
for (const result of results) console.log(`  ${result}`);
