import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { workflowRoutes } from '../lib/events/workflow-api.js';
import sharp from 'sharp';

async function fixture(t, row) {
  const directory = await mkdtemp(join(tmpdir(), 'attendance-route-'));
  const previous = process.env.WORKFLOW_EVIDENCE_DIR;
  process.env.WORKFLOW_EVIDENCE_DIR = directory;

  t.after(async () => {
    if (previous === undefined) {
      delete process.env.WORKFLOW_EVIDENCE_DIR;
    } else {
      process.env.WORKFLOW_EVIDENCE_DIR = previous;
    }
    await rm(directory, { recursive: true, force: true });
  });

  const bytes = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 40, g: 100, b: 160 },
    },
  }).jpeg().toBuffer();

  const req = Readable.from([bytes]);
  req.method = 'POST';
  req.headers = { host: 'localhost' };

  const workflow = {
    ownRegistration: async () => row,
  };
  const ctx = {
    requirePortalSession: () => ({ username: 'synthetic-user' }),
    requireCsrf: () => true,
    getAccount: async () => ({ accountId: 'synthetic-account' }),
    getWorkflow: async () => workflow,
    json: (res, status, body) => ({ status, body }),
  };

  return {
    directory,
    bytes,
    workflow,
    invoke: () => workflowRoutes(
      req,
      {},
      new URL(
        'http://localhost/api/portal/workflow/registrations/synthetic-code/attendance',
      ),
      ctx,
    ),
  };
}

test('attendance route preserves the photo after a lost write acknowledgement', async t => {
  const row = { 报名状态: '已确认' };
  const f = await fixture(t, row);
  const failure = new Error('synthetic-response-lost');

  f.workflow.submitAttendance = async (code, account, photoId) => {
    assert.equal(code, 'synthetic-code');
    assert.equal(account.accountId, 'synthetic-account');
    row['签到照片ID'] = photoId;
    throw failure;
  };

  await assert.rejects(f.invoke(), error => error === failure);

  const files = await readdir(f.directory);
  assert.deepEqual(files, [row['签到照片ID']]);
  const stored = await readFile(join(f.directory, row['签到照片ID']));
  assert.deepEqual(stored, f.bytes);
});

test('an ineligible registration is rejected before storing a photo', async t => {
  const f = await fixture(t, { 报名状态: '待筛选' });
  let writes = 0;
  f.workflow.submitAttendance = async () => { writes++; };

  const result = await f.invoke();

  assert.equal(result.status, 409);
  assert.equal(writes, 0);
  assert.deepEqual(await readdir(f.directory), []);
});