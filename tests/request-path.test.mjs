import test from 'node:test';
import assert from 'node:assert/strict';
import { assertApiRequestPath } from '../lib/http/request-path.js';
import { apiFailure } from '../lib/http/errors.js';

function invalidPath(error) {
  return error.statusCode === 400
    && error.code === 'invalid_request_path';
}

test('ordinary API paths are accepted', () => {
  for (const path of [
    '/api/auth/session',
    '/api/materials/overview',
    '/api/volunteer/workflow/events/synthetic/approve',
    '/api/public/events',
  ]) {
    assert.doesNotThrow(() => assertApiRequestPath(path));
  }
});

test('encoded Chinese and email identifiers remain valid', () => {
  for (const id of ['合成活动', 'member@example.test']) {
    assert.doesNotThrow(() => {
      assertApiRequestPath(`/api/events/${encodeURIComponent(id)}`);
    });
  }
});

test('a correctly encoded percent sign is accepted without double decoding', () => {
  assert.doesNotThrow(() => {
    assertApiRequestPath('/api/event-notices/notice%25/publish');
  });

  assert.doesNotThrow(() => {
    assertApiRequestPath('/api/events/value%2520');
  });
});

test('encoded separators are not rewritten by the validator', () => {
  for (const path of [
    '/api/materials/operations/synthetic%2Fkey',
    '/api/events/synthetic%3Fvalue',
    '/api/events/synthetic%23value',
  ]) {
    assert.doesNotThrow(() => assertApiRequestPath(path));
  }
});

test('broken percent escapes return a classified client error', () => {
  for (const path of [
    '/api/events/%',
    '/api/events/%2',
    '/api/events/%GG',
  ]) {
    assert.throws(() => assertApiRequestPath(path), error => {
      assert.ok(invalidPath(error));

      const response = apiFailure(error);
      assert.equal(response.status, 400);
      assert.equal(response.payload.code, 'invalid_request_path');
      assert.equal(response.payload.message.includes(path), false);
      return true;
    });
  }
});

test('invalid encoded UTF-8 is rejected', () => {
  for (const suffix of [
    '%C3%28',
    '%E4%B8',
    '%ED%A0%80',
    '%FF',
  ]) {
    assert.throws(
      () => assertApiRequestPath(`/api/events/${suffix}`),
      invalidPath,
    );
  }
});

test('encoded and literal control characters are rejected', () => {
  for (const suffix of [
    '%00',
    '%0A',
    '%0D',
    '%1F',
    '%7F',
    '\u0000',
    '\u0009',
  ]) {
    assert.throws(
      () => assertApiRequestPath(`/api/events/${suffix}`),
      invalidPath,
    );
  }
});

test('non-API paths and invalid argument types are rejected', () => {
  for (const path of [
    undefined,
    null,
    123,
    {},
    '',
    '/',
    '/events',
    '/api-other/events',
  ]) {
    assert.throws(() => assertApiRequestPath(path), invalidPath);
  }
});