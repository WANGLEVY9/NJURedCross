import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOpsRoutes } from '../lib/events/api.js';
import { NOTICE_TABLE } from '../lib/events/notice.js';
import { ATTACHMENT_TABLE } from '../lib/events/njubox.js';

const PROJECT_TABLE = '活动项目表';

function rows(count, fields = () => ({})) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `synthetic-${index}`,
    ...fields(index),
  }));
}

function fixture(tables = {}) {
  const events = [];
  const writes = [];
  const audits = [];

  const client = {
    listRows: async (table, _view, _order, _direction, start, limit) => {
      events.push({ type: 'read', table, start, limit });
      return (tables[table] || []).slice(start, start + limit);
    },
    appendRow: async (table, row) => {
      events.push({ type: 'append', table });
      writes.push({ type: 'append', table, row });
      return { _id: 'created-notice' };
    },
    updateRow: async (table, id, patch) => {
      events.push({ type: 'update', table });
      writes.push({ type: 'update', table, id, patch });
    },
  };

  const ctx = {
    getBase: async () => client,
    requireConsoleAccess: () => ({ username: 'synthetic-admin' }),
    requireCsrf: () => true,
    readJson: async req => req.body,
    identifier: () => 'NOT-SYNTHETIC',
    recordAudit: async (...args) => { audits.push(args); },
    json: (_res, status, body) => ({ status, body }),
    tables: { project: PROJECT_TABLE },
    config: {},
  };

  return {
    events,
    writes,
    audits,
    client,
    run(path, method = 'GET', body = {}) {
      return eventsOpsRoutes(
        { method, headers: {}, body },
        null,
        new URL(path, 'http://localhost'),
        ctx,
      );
    },
  };
}

test('notice filtering finds records beyond the first page', async () => {
  const f = fixture({
    [NOTICE_TABLE]: rows(501, index => ({
      通知ID: `notice-${index}`,
      活动ID: index === 500 ? 'target' : 'other',
    })),
  });

  const result = await f.run('/api/event-notices?eventId=target');

  assert.equal(result.status, 200);
  assert.equal(result.body.notices.length, 1);
  assert.equal(result.body.notices[0].noticeId, 'notice-500');
  assert.equal(f.writes.length, 0);
});

test('attachment filtering finds records beyond the first page', async () => {
  const f = fixture({
    [ATTACHMENT_TABLE]: rows(501, index => ({
      附件ID: `attachment-${index}`,
      活动ID: index === 500 ? 'target' : 'other',
    })),
  });

  const result = await f.run('/api/event-attachments?eventId=target');

  assert.equal(result.status, 200);
  assert.equal(result.body.attachments.length, 1);
  assert.equal(result.body.attachments[0].attachmentId, 'attachment-500');
  assert.equal(f.writes.length, 0);
});

test('publishing finds a notice beyond the old 200-row limit', async () => {
  const f = fixture({
    [NOTICE_TABLE]: rows(501, index => ({
      通知ID: `notice-${index}`,
      活动ID: 'synthetic-event',
      状态: '草稿',
    })),
  });

  const result = await f.run(
    '/api/event-notices/notice-500/publish',
    'POST',
  );

  assert.equal(result.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].id, 'synthetic-500');
  assert.equal(f.writes[0].patch.状态, '已发布');
});

test('truncated notice data cannot authorize publication', async () => {
  const f = fixture({
    [NOTICE_TABLE]: rows(5001, index => ({
      通知ID: `notice-${index}`,
    })),
  });

  await assert.rejects(
    f.run('/api/event-notices/notice-0/publish', 'POST'),
    error => error.code === 'incomplete_operational_data',
  );

  assert.equal(f.writes.length, 0);
  assert.equal(f.audits.length, 0);
});

test('description filling reads all projects before creating a notice', async () => {
  const f = fixture({
    [PROJECT_TABLE]: rows(501, index => ({
      活动ID: index === 500 ? 'target' : `other-${index}`,
    })),
  });

  const result = await f.run('/api/event-notices', 'POST', {
    eventId: 'target',
    name: '模拟活动',
    fillDescription: true,
  });

  assert.equal(result.status, 201);
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].type, 'update');
  assert.equal(f.writes[1].id, 'synthetic-500');
  assert.equal(f.writes[1].table, PROJECT_TABLE);

  const lastRead = f.events.findLastIndex(event => event.type === 'read');
  const firstWrite = f.events.findIndex(event => event.type === 'append');
  assert.ok(lastRead >= 0 && lastRead < firstWrite);
});

test('truncated projects stop before any notice creation', async () => {
  const f = fixture({
    [PROJECT_TABLE]: rows(5001, index => ({
      活动ID: index === 0 ? 'target' : `other-${index}`,
    })),
  });

  await assert.rejects(
    f.run('/api/event-notices', 'POST', {
      eventId: 'target',
      fillDescription: true,
    }),
    error => error.code === 'incomplete_operational_data',
  );

  assert.equal(f.writes.length, 0);
  assert.equal(f.audits.length, 0);
});

test('duplicate project identifiers stop before creating a notice', async () => {
  const f = fixture({
    [PROJECT_TABLE]: rows(2, () => ({ 活动ID: 'target' })),
  });

  const result = await f.run('/api/event-notices', 'POST', {
    eventId: 'target',
    fillDescription: true,
  });

  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ambiguous_event_project');
  assert.equal(f.writes.length, 0);
  assert.equal(f.audits.length, 0);
});