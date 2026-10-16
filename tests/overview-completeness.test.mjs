import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertCompleteRows } from '../lib/events/safety.js';

const source = (await readFile(
  new URL('../server.js', import.meta.url),
  'utf8',
)).replace(/\r\n/g, '\n');

function truncated() {
  const rows = [];
  Object.defineProperty(rows, 'readMeta', {
    value: { truncated: true },
  });
  return rows;
}

function fixture(name, datasets = {}) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf('\n}', start);

  assert.ok(start >= 0 && end > start);

  const box = {
    assertCompleteRows,
    materialsTable: 'applications',
    inventoryTable: 'inventory',
    eventProjectTable: 'projects',
    eventSessionTable: 'sessions',
    eventRegistrationTable: 'registrations',
    publicPrograms: [],
    publicEmailDomains: [],
    listAllRows: async (_client, table) => (
      Object.hasOwn(datasets, table) ? datasets[table] : []
    ),
    getPublicEvents: async () => datasets.events || [],
    readMeta: rows => rows.readMeta || {
      total: rows.length,
      truncated: false,
      maxRows: null,
    },
    applicationSummary: row => row,
    inventorySummary: row => row,
    eventSummary: row => row,
    dailySeries: () => ({}),
    Date,
  };

  vm.createContext(box);
  vm.runInContext(
    source.slice(start, end + 2) +
      `\nglobalThis.load = ${name};`,
    box,
  );

  return {
    box,
    load: () => box.load({}),
  };
}

const incomplete = error => (
  error.code === 'incomplete_operational_data'
  && error.statusCode === 503
);

test('material overview rejects truncation in any required table', async () => {
  for (const table of [
    'applications',
    'inventory',
    '物资配置表',
    '物资流水表',
  ]) {
    const f = fixture('getMaterialsOverview', {
      [table]: truncated(),
    });

    await assert.rejects(f.load(), incomplete);
  }
});

test('event overview rejects truncation in any required table', async () => {
  for (const table of ['projects', 'sessions', 'registrations']) {
    const f = fixture('getEventsOverview', {
      [table]: truncated(),
    });

    await assert.rejects(f.load(), incomplete);
  }
});

test('homepage rejects incomplete inventory and event inputs', async () => {
  for (const table of ['inventory', 'events']) {
    const f = fixture('loadPublicOverview', {
      [table]: truncated(),
    });

    await assert.rejects(f.load(), incomplete);
  }
});

test('complete empty datasets still produce valid zero statistics', async () => {
  const materials = await fixture('getMaterialsOverview').load();
  assert.equal(materials.ok, true);
  assert.equal(materials.stats.totalCurrentQuantity, 0);
  assert.equal(materials.stats.flowCount, 0);

  const events = await fixture('getEventsOverview').load();
  assert.equal(events.ok, true);
  assert.equal(events.stats.projects, 0);
  assert.equal(events.stats.registrations, 0);

  const homepage = await fixture('loadPublicOverview').load();
  assert.equal(homepage.ok, true);
  assert.equal(homepage.stats.inventoryCategories, 0);
  assert.equal(homepage.stats.openSeats, 0);
});

test('invalid datasets cannot become apparently valid statistics', async () => {
  for (const [name, table] of [
    ['getMaterialsOverview', 'applications'],
    ['getEventsOverview', 'projects'],
    ['loadPublicOverview', 'inventory'],
  ]) {
    const f = fixture(name, { [table]: null });
    await assert.rejects(f.load(), incomplete);
  }
});

test('upstream read failure is not converted into an empty overview', async () => {
  for (const name of [
    'getMaterialsOverview',
    'getEventsOverview',
    'loadPublicOverview',
  ]) {
    const f = fixture(name);
    const failure = new Error('synthetic-read-failure');

    f.box.listAllRows = async () => { throw failure; };

    await assert.rejects(
      f.load(),
      error => error === failure,
    );
  }
});
function volunteerFixture(datasets = {}) {
  const f = fixture('getVolunteerOverview', datasets);

  f.box.volunteerRows = f.box.listAllRows;
  f.box.volunteerBaseUuid = 'synthetic-volunteer-base';
  f.box.summarizeVolunteerWorkflow = () => ({
    groups: [],
    states: {},
    orphanCheckins: 0,
    registrationsWithVerifiedCheckin: 0,
  });

  return f;
}

test('volunteer overview rejects truncation in each required source', async () => {
  for (const table of [
    '活动报名总表',
    '活动签到',
    '登记审批',
    '个人主页（编辑版）',
    '活动及时长汇总表',
  ]) {
    await assert.rejects(
      volunteerFixture({ [table]: truncated() }).load(),
      incomplete,
    );
  }
});

test('complete empty volunteer tables produce valid zero statistics', async () => {
  const report = await volunteerFixture().load();

  assert.equal(report.ok, true);
  assert.equal(report.stats.memberProfiles, 0);
  assert.equal(report.stats.registrations, 0);
  assert.equal(report.stats.hoursQueue, 0);
  assert.equal(report.workflow.complete, true);
});

test('volunteer source failures do not become a zero overview', async () => {
  const f = volunteerFixture();
  const failure = new Error('synthetic-volunteer-read-failure');

  f.box.volunteerRows = async () => { throw failure; };

  await assert.rejects(
    f.load(),
    error => error === failure,
  );
});