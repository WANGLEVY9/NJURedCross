import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFailure } from '../lib/http/errors.js';

const secret = 'synthetic-private-token';

function assertSanitized(result) {
  assert.equal(JSON.stringify(result).includes(secret), false);
}

test('unexpected exceptions hide messages, codes and causes', () => {
  const error = Object.assign(new Error(`/private/${secret}`), {
    code: secret,
    cause: new Error(secret),
  });

  const result = apiFailure(error);

  assert.equal(result.status, 500);
  assert.equal(result.payload.code, null);
  assertSanitized(result);
});

test('explicit server failures retain safe codes but hide details', () => {
  for (const statusCode of [500, 502, 503]) {
    const result = apiFailure({
      statusCode,
      code: 'storage_unavailable',
      message: secret,
    });

    assert.equal(result.status, statusCode);
    assert.equal(result.payload.code, 'storage_unavailable');
    assertSanitized(result);
  }
});

test('explicit client errors retain business messages and statuses', () => {
  for (const statusCode of [400, 401, 403, 404, 409, 413, 429]) {
    const result = apiFailure({
      statusCode,
      code: 'invalid_request',
      message: '请检查提交参数。',
    });

    assert.equal(result.status, statusCode);
    assert.equal(result.payload.code, 'invalid_request');
    assert.equal(result.payload.message, '请检查提交参数。');
  }
});

test('upstream authentication failures cannot become application logout', () => {
  for (const status of [401, 403]) {
    const result = apiFailure({
      code: secret,
      message: secret,
      response: { status, data: { detail: secret } },
    });

    assert.equal(result.status, 503);
    assert.equal(result.payload.code, 'seatable_auth_failed');
    assert.equal(result.payload.seaTableStatus, status);
    assertSanitized(result);
  }
});

test('other upstream failures hide their messages and codes', () => {
  const result = apiFailure({
    code: secret,
    message: secret,
    response: { status: 500, data: secret },
  });

  assert.equal(result.status, 502);
  assert.equal(result.payload.code, null);
  assert.equal(result.payload.seaTableStatus, 500);
  assertSanitized(result);
});

test('malformed application codes are not exposed', () => {
  for (const code of [
    `/private/${secret}`,
    'invalid code',
    'x'.repeat(81),
    { token: secret },
  ]) {
    const result = apiFailure({
      statusCode: 503,
      code,
      message: secret,
    });

    assert.equal(result.payload.code, null);
    assertSanitized(result);
  }
});

test('invalid status values cannot control the HTTP response', () => {
  for (const status of [0, 200, 600, '503', NaN, Infinity]) {
    const result = apiFailure({
      statusCode: status,
      message: secret,
      response: { status },
    });

    assert.equal(result.status, 500);
    assert.equal(result.payload.seaTableStatus, null);
    assertSanitized(result);
  }
});

test('Axios cancellation keeps its public cancellation classification', () => {
  const result = apiFailure({
    code: 'ERR_CANCELED',
    message: secret,
    cause: new Error(secret),
  });

  assert.equal(result.status, 503);
  assert.equal(result.payload.code, 'external_request_cancelled');
  assertSanitized(result);
});

test('request deadlines retain a code and warn about uncertain writes', () => {
  const result = apiFailure({
    statusCode: 503,
    code: 'external_request_timeout',
    message: secret,
  });

  assert.equal(result.status, 503);
  assert.equal(result.payload.code, 'external_request_timeout');
  assert.ok(result.payload.message.includes('核对'));
  assertSanitized(result);
});