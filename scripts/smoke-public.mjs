const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

const pages = ['/', '/events', '/materials', '/submit', '/warmth', '/status', '/about', '/console/login'];
const assets = ['/app/main.js', '/styles/tokens.css', '/styles/base.css', '/styles/components.css', '/styles/portal.css', '/styles/admin.css'];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...options });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body, contentType };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// A fresh deployment restarts the service before this smoke runs; the first
// seconds of a new process can still be warming identity sources, so 5xx and
// network failures get a bounded retry. Body validation failures are real
// regressions and are never retried.
const startupBudgetMs = Number(process.env.SMOKE_STARTUP_BUDGET_MS) || 120_000;
const startupIntervalMs = Number(process.env.SMOKE_STARTUP_INTERVAL_MS) || 10_000;

function transientError(message) {
  return Object.assign(new Error(message), { transient: true });
}

async function withStartupGrace(attempt) {
  const deadline = Date.now() + startupBudgetMs;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!error?.transient || Date.now() + startupIntervalMs > deadline) throw error;
      console.log(`  transient failure, retrying within startup grace: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, startupIntervalMs));
    }
  }
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
  return withStartupGrace(async () => {
    let response;
    let body;
    let contentType;
    try {
      ({ response, body, contentType } = await request(path));
    } catch (error) {
      throw transientError(`${path} request failed: ${error?.cause?.code || error?.name || 'unknown'}`);
    }
    if (response.status >= 500) throw transientError(`${path} returned ${response.status}`);
    assert(response.status === 200, `${path} returned ${response.status}`);
    assert(contentType.includes('application/json'), `${path} did not return JSON`);
    assert(body?.ok === true, `${path} did not return ok=true`);
    validate(body);
    return `${response.status} ${path}`;
  });
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

const missingEvent = await withStartupGrace(async () => {
  const attempt = await request('/api/public/events/SMOKE-NOT-FOUND');
  if (attempt.response.status >= 500) throw transientError(`missing public event returned ${attempt.response.status}`);
  assert(attempt.response.status === 404, `missing public event returned ${attempt.response.status}`);
  assert(attempt.body?.ok === false, 'missing public event did not return ok=false');
  return '404 /api/public/events/SMOKE-NOT-FOUND';
});
results.push(missingEvent);

const protectedHealth = await request('/api/health');
assert(protectedHealth.response.status === 401, `unauthenticated /api/health returned ${protectedHealth.response.status}`);
results.push('401 /api/health (unauthenticated boundary)');

console.log(`Public smoke check passed against ${baseUrl}`);
for (const result of results) console.log(`  ${result}`);
