import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  passwordPolicyError,
  realNameError,
  registrationProfileError,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_HINT,
} from '../public/app/core/password-policy.js';

// Built at runtime so the source file never carries literal control characters.
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

test('a password with all four character classes is accepted', () => {
  assert.equal(passwordPolicyError('Passw0rd!'), '');
  assert.equal(passwordPolicyError('Nju@2026rc'), '');
});

test('length below the minimum is rejected', () => {
  assert.equal(passwordPolicyError('Aa1!'.padEnd(MIN_PASSWORD_LENGTH - 1, 'x')), PASSWORD_HINT);
});

test('length above the maximum is rejected', () => {
  assert.equal(passwordPolicyError(`Aa1!${'x'.repeat(MAX_PASSWORD_LENGTH - 3)}`), PASSWORD_HINT);
});

test('a missing character class is rejected', () => {
  assert.equal(passwordPolicyError('password1!'), PASSWORD_HINT); // no uppercase
  assert.equal(passwordPolicyError('PASSWORD1!'), PASSWORD_HINT); // no lowercase
  assert.equal(passwordPolicyError('Password!'), PASSWORD_HINT); // no digit
  assert.equal(passwordPolicyError('Password1'), PASSWORD_HINT); // no symbol
});

test('control characters and non-string input are rejected', () => {
  assert.equal(passwordPolicyError('Passw0rd!\n'), PASSWORD_HINT);
  assert.equal(passwordPolicyError(`Passw0rd!${NUL}`), PASSWORD_HINT);
  assert.equal(passwordPolicyError(`Passw0rd!${DEL}`), PASSWORD_HINT);
  assert.equal(passwordPolicyError(null), PASSWORD_HINT);
  assert.equal(passwordPolicyError(12345678), PASSWORD_HINT);
});

test('real names accept CJK, latin, separators and diacritics', () => {
  assert.equal(realNameError('张三'), '');
  assert.equal(realNameError('欧阳·娜娜'), '');
  assert.equal(realNameError("Mary-Jane O'Neil"), '');
  assert.equal(realNameError(' 李四 '), '');
});

test('real names reject empty, leading-digit and overlong values', () => {
  assert.match(realNameError(''), /真实姓名/);
  assert.match(realNameError('1张三'), /真实姓名/);
  assert.match(realNameError('张'.repeat(41)), /真实姓名/);
});

test('registration profile validates name before student id', () => {
  assert.equal(registrationProfileError('张三', '2023123456'), '');
  assert.match(registrationProfileError('', '2023123456'), /真实姓名/);
  assert.match(registrationProfileError('张三', '12345'), /学号/);
  assert.match(registrationProfileError('张三', '1'.repeat(21)), /学号/);
  assert.match(registrationProfileError('张三', '2023123456a'), /学号/);
});
