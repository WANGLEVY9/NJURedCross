import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { createPasswordWorkQueue } from './password-work.js';

const derive = promisify(scrypt);
const run = createPasswordWorkQueue();

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function invalidPassword() {
  return Object.assign(
    new Error('密码格式不正确。'),
    { statusCode: 400, code: 'invalid_password' },
  );
}

function parseHash(stored) {
  if (typeof stored !== 'string' || stored.length > 1024) {
    return null;
  }

  const parts = stored.split('$');

  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return null;
  }

  const [, nText, rText, pText, saltText, hashText] = parts;

  if (
    !/^\d{1,6}$/.test(nText)
    || !/^\d{1,2}$/.test(rText)
    || !/^\d{1,2}$/.test(pText)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(saltText)
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(hashText)
  ) {
    return null;
  }

  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);

  if (
    n < 2 || n > 32_768 || (n & (n - 1)) !== 0
    || r < 1 || r > 8
    || p < 1 || p > 2
  ) {
    return null;
  }

  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(hashText, 'base64');

  if (
    salt.length < 16 || salt.length > 64
    || expected.length !== KEY_LENGTH
    || salt.toString('base64') !== saltText
    || expected.toString('base64') !== hashText
  ) {
    return null;
  }

  return { n, r, p, salt, expected };
}

export async function hashPasswordAsync(password) {
  if (
    typeof password !== 'string'
    || !password
    || password.length > 72
  ) {
    throw invalidPassword();
  }

  return run(async () => {
    const salt = randomBytes(16);
    const hash = await derive(password, salt, KEY_LENGTH, {
      N,
      r: R,
      p: P,
      maxmem: MAX_MEMORY,
    });

    return [
      'scrypt',
      N,
      R,
      P,
      salt.toString('base64'),
      hash.toString('base64'),
    ].join('$');
  });
}

export async function verifyPasswordAsync(password, stored) {
  if (
    typeof password !== 'string'
    || !password
    || password.length > 72
  ) {
    return false;
  }

  const parsed = parseHash(stored);
  if (!parsed) return false;

  return run(async () => {
    try {
      const actual = await derive(
        password,
        parsed.salt,
        KEY_LENGTH,
        {
          N: parsed.n,
          r: parsed.r,
          p: parsed.p,
          maxmem: MAX_MEMORY,
        },
      );

      return timingSafeEqual(actual, parsed.expected);
    } catch {
      return false;
    }
  });
}