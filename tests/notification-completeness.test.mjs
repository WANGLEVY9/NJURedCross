import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

const start = source.indexOf('async function getNotificationsOverview(');
const end = source.indexOf('\nasync function getEventsOverview(', start);
assert.ok(start >= 0 && end > start);
const block = source.slice(start, end);

function fixture({
  permissions = ['materials', 'events', 'outreach', 'community'],
  failure = null,
  volunteerConfigured = true,
} = {}) {
  const calls = [];
  const readError = new Error('Synthetic source unavailable');

  const reader = (name, value) => async () => {
    calls.push(name);
    if (failure === name) throw readError;
    return value;
  };

  const box = {
    CONSOLE_PERMISSION_SCOPES: permissions,
    normalizePermissions: value => value,
    volunteerBase: volunteerConfigured,
    getVolunteerBase: async () => ({}),
    getMaterialsOverview: reader('materials', {
      overdue: [],
      lowStock: [],
      pending: [],
    }),
    getEventsOverview: reader('events', { events: [] }),
    getOutreachOverview: reader('outreach', { campaigns: [] }),
    getVolunteerOverview: reader('volunteer', { hoursQueue: [] }),
    readCommunitySubmissions: reader('community', []),
    readPublicSubmissions: reader('publicSubmissions', []),
    readWarmthInterests: reader('warmth', []),
  };

  vm.createContext(box);
  vm.runInContext(
    block + '\nglobalThis.load = getNotificationsOverview;',
    box,
  );

  return {
    load: () => box.load({}, permissions),
    calls,
    readError,
  };
}

test('successful empty sources produce an empty notification queue', async () => {
  const f = fixture();
  const result = await f.load();

  assert.equal(result.ok, true);
  assert.equal(result.stats.total, 0);
  assert.equal(result.items.length, 0);
  assert.equal(f.calls.length, 7);
});

test('any failed source prevents a misleading successful summary', async () => {
  for (const failure of [
    'materials',
    'events',
    'outreach',
    'volunteer',
    'community',
    'publicSubmissions',
    'warmth',
  ]) {
    const f = fixture({ failure });

    await assert.rejects(f.load(), error => error === f.readError);
  }
});

test('unauthorized sources are not read and do not block the summary', async () => {
  const f = fixture({
    permissions: ['materials'],
    failure: 'events',
  });
  const result = await f.load();

  assert.equal(result.ok, true);
  assert.equal(result.stats.total, 0);
  assert.deepEqual(f.calls, ['materials']);
});

test('an unconfigured optional volunteer source does not block the summary', async () => {
  const f = fixture({
    permissions: ['events'],
    volunteerConfigured: false,
    failure: 'volunteer',
  });
  const result = await f.load();

  assert.equal(result.ok, true);
  assert.equal(result.stats.total, 0);
  assert.deepEqual(f.calls, ['events']);
});