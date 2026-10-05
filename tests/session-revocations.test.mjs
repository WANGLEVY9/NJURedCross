import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionRevocations } from '../lib/identity/session-revocations.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'session-revocations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    file: join(directory, 'revocations.json'),
  };
}

test('revocations survive reopening without storing raw session identifiers', async t => {
  const { file } = await fixture(t);
  const options = { file, now: () => 1000 };
  const store = await createSessionRevocations(options);

  assert.equal(store.has('synthetic-session'), false);
  await store.revoke('synthetic-session', 2000);
  assert.equal(store.has('synthetic-session'), true);

  const reopened = await createSessionRevocations(options);
  assert.equal(reopened.has('synthetic-session'), true);
  assert.equal(reopened.has('another-session'), false);
  assert.equal((await readFile(file, 'utf8')).includes('synthetic-session'), false);
});

test('expired records are rejected and removed on the next save', async t => {
  const { file } = await fixture(t);
  let time = 1000;
  const options = { file, now: () => time };
  const store = await createSessionRevocations(options);

  await store.revoke('old-session', 1500);
  time = 1500;
  assert.equal(store.has('old-session'), false);

  await store.revoke('new-session', 3000);
  const document = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(document.entries.length, 1);

  const reopened = await createSessionRevocations(options);
  assert.equal(reopened.has('old-session'), false);
  assert.equal(reopened.has('new-session'), true);
});

test('concurrent saves preserve every revocation', async t => {
  const { file } = await fixture(t);
  const options = { file, now: () => 1000 };
  const store = await createSessionRevocations(options);

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      store.revoke(`session-${index}`, 2000),
    ),
  );

  const reopened = await createSessionRevocations(options);
  for (let index = 0; index < 20; index++) {
    assert.equal(reopened.has(`session-${index}`), true);
  }
});

test('corrupt storage prevents loading instead of silently forgetting revocations', async t => {
  const { file } = await fixture(t);

  await writeFile(file, 'invalid json', 'utf8');
  await assert.rejects(createSessionRevocations({ file }));

  await writeFile(
    file,
    JSON.stringify({ version: 1, entries: [['invalid-hash', 2000]] }),
    'utf8',
  );
  await assert.rejects(createSessionRevocations({ file }));
});

test('failed persistence rejects and can be retried without losing revocations', async t => {
  const { directory } = await fixture(t);
  const parent = join(directory, 'blocked');
  await writeFile(parent, 'not a directory', 'utf8');

  const options = {
    file: join(parent, 'revocations.json'),
    now: () => 1000,
  };
  const store = await createSessionRevocations(options);

  await assert.rejects(store.revoke('first-session', 2000));
  assert.equal(store.has('first-session'), true);

  await rm(parent);
  await store.revoke('second-session', 2000);

  const reopened = await createSessionRevocations(options);
  assert.equal(reopened.has('first-session'), true);
  assert.equal(reopened.has('second-session'), true);
});

test('invalid revocation input is rejected', async t => {
  const { file } = await fixture(t);
  const store = await createSessionRevocations({ file, now: () => 1000 });

  await assert.rejects(store.revoke('', 2000));
  await assert.rejects(store.revoke('session', NaN));
  await assert.rejects(store.revoke('session', 1000));
  assert.equal(store.has('session'), false);
});