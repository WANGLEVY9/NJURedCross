import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  verifyPassword,
} from '../lib/identity/store.js';
import {
  hashPasswordAsync,
  verifyPasswordAsync,
} from '../lib/identity/password-async.js';

const password = 'Synthetic-Password-123!';

test('async verification accepts existing synchronous hashes', async () => {
  const stored = hashPassword(password);

  assert.equal(await verifyPasswordAsync(password, stored), true);
  assert.equal(
    await verifyPasswordAsync('Wrong-Password-123!', stored),
    false,
  );
});

test('async hashes retain the existing storage format', async () => {
  const stored = await hashPasswordAsync(password);
  const parts = stored.split('$');

  assert.equal(parts.length, 6);
  assert.deepEqual(parts.slice(0, 4), ['scrypt', '16384', '8', '1']);
  assert.equal(Buffer.from(parts[4], 'base64').length, 16);
  assert.equal(Buffer.from(parts[5], 'base64').length, 64);
  assert.equal(verifyPassword(password, stored), true);
});

test('new hashes use different salts for identical passwords', async () => {
  const first = await hashPasswordAsync(password);
  const second = await hashPasswordAsync(password);

  assert.notEqual(first, second);
  assert.notEqual(first.split('$')[4], second.split('$')[4]);
  assert.equal(await verifyPasswordAsync(password, first), true);
  assert.equal(await verifyPasswordAsync(password, second), true);
});

test('malformed and excessive hash parameters are rejected', async () => {
  const valid = hashPassword(password);
  const parts = valid.split('$');

  const malformed = [
    null,
    '',
    'plaintext-password',
    'scrypt$16384$8$1$invalid$invalid',
    ['scrypt', '999999', '8', '1', parts[4], parts[5]].join('$'),
    ['scrypt', '16384', '99', '1', parts[4], parts[5]].join('$'),
    ['scrypt', '16384', '8', '99', parts[4], parts[5]].join('$'),
    ['scrypt', '16385', '8', '1', parts[4], parts[5]].join('$'),
    ['scrypt', '16384', '8', '1', '', parts[5]].join('$'),
    'x'.repeat(1025),
  ];

  for (const stored of malformed) {
    assert.equal(await verifyPasswordAsync(password, stored), false);
  }
});

test('invalid passwords cannot create hashes or authenticate', async () => {
  const stored = hashPassword(password);

  for (const value of [null, undefined, '', 123, 'x'.repeat(73)]) {
    await assert.rejects(
      hashPasswordAsync(value),
      error => (
        error.code === 'invalid_password'
        && error.statusCode === 400
      ),
    );

    assert.equal(await verifyPasswordAsync(value, stored), false);
  }
});

test('concurrent calculations preserve password isolation', async () => {
  const firstPassword = 'Synthetic-First-123!';
  const secondPassword = 'Synthetic-Second-456!';

  const [first, second] = await Promise.all([
    hashPasswordAsync(firstPassword),
    hashPasswordAsync(secondPassword),
  ]);

  assert.deepEqual(await Promise.all([
    verifyPasswordAsync(firstPassword, first),
    verifyPasswordAsync(secondPassword, second),
    verifyPasswordAsync(firstPassword, second),
    verifyPasswordAsync(secondPassword, first),
  ]), [true, true, false, false]);
});
