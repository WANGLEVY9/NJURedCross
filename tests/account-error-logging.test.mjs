import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (
  await readFile(new URL('../server.js', import.meta.url), 'utf8')
).replace(/\r\n/g, '\n');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);

  assert.ok(from >= 0 && to > from, 'Account function markers must exist');
  return source.slice(from, to);
}

const fileLoader = section(
  'async function loadAccountsFromFile()',
  '\n/**',
);

const accountLoader = section(
  'async function loadAccounts()',
  '\nconst accountLoad =',
);

const secret = 'synthetic-private-password';

test('account file failures omit raw parser details and private paths', async () => {
  const messages = [];
  const stopped = new Error('synthetic-process-exit');

  const context = {
    process: {
      env: { PLATFORM_ACCOUNTS_FILE: 'configured' },
      exit: () => { throw stopped; },
    },
    accountsFile: `/private/${secret}/accounts.json`,
    readFile: async () => { throw new Error(`JSON parse failed: ${secret}`); },
    console: {
      error: (...args) => messages.push(args.join(' ')),
    },
  };

  vm.createContext(context);
  vm.runInContext(`${fileLoader}\nglobalThis.load = loadAccountsFromFile;`, context);

  await assert.rejects(context.load(), error => error === stopped);

  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('check'));
  assert.equal(messages[0].includes(secret), false);
  assert.equal(messages[0].includes('/private/'), false);
});

test('legacy fallback warnings omit upstream error details', async () => {
  const messages = [];
  let fallbackCalls = 0;

  const context = {
    identityApiToken: '',
    getIdentityBase: async () => {
      throw new Error(`Authorization failed: ${secret}`);
    },
    loadAccountsFromFile: async () => {
      fallbackCalls++;
      return [{ username: 'synthetic-admin' }];
    },
    accountsFile: 'synthetic-accounts.json',
    console: {
      warn: (...args) => messages.push(args.join(' ')),
    },
  };

  vm.createContext(context);
  vm.runInContext(`${accountLoader}\nglobalThis.load = loadAccounts;`, context);

  const result = await context.load();

  assert.equal(fallbackCalls, 1);
  assert.equal(result.accounts[0].username, 'synthetic-admin');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].includes(secret), false);
});

test('private identity failures still refuse local credential fallback', async () => {
  let fallbackCalls = 0;
  const messages = [];

  const context = {
    identityApiToken: 'synthetic-configured-token',
    getIdentityBase: async () => { throw new Error(secret); },
    loadAccountsFromFile: async () => {
      fallbackCalls++;
      return [];
    },
    console: {
      warn: (...args) => messages.push(args.join(' ')),
    },
  };

  vm.createContext(context);
  vm.runInContext(`${accountLoader}\nglobalThis.load = loadAccounts;`, context);

  await assert.rejects(context.load(), error => {
    assert.ok(error.message.includes('refusing credential fallback'));
    assert.equal(error.message.includes(secret), false);
    return true;
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(messages.length, 0);
});