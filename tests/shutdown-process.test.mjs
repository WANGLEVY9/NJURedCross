import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const shutdownUrl = new URL(
  '../lib/http/shutdown.js',
  import.meta.url,
).href;
const signalsUrl = new URL(
  '../lib/http/shutdown-signals.js',
  import.meta.url,
).href;

const fixture = `
import http from 'node:http';
import {
  createHttpShutdown,
  registerShutdownCleanup,
} from ${JSON.stringify(shutdownUrl)};
import {
  registerShutdownSignals,
} from ${JSON.stringify(signalsUrl)};

const mode = process.argv[1];
const timer = setInterval(() => {}, 1000);

const server = http.createServer((req, res) => {
  if (mode === 'busy') {
    process.send({ ready: true });
  } else {
    res.end('synthetic');
  }
});

registerShutdownCleanup(server, () => clearInterval(timer));
registerShutdownSignals({
  server,
  shutdown: createHttpShutdown(server, { timeoutMs: 100 }),
});

process.on('message', message => {
  if (message === 'shutdown') {
    if (mode === 'background') {
      setTimeout(() => {
        process.stdout.write('synthetic-background-completed');
      }, 200);
    }

    process.disconnect();
    process.emit('SIGTERM');
  }
});

server.listen(0, '127.0.0.1', () => {
  if (mode !== 'busy') {
    process.send({ ready: true });
  } else {
    const client = http.get({
      hostname: '127.0.0.1',
      port: server.address().port,
      agent: false,
    });
    client.on('error', () => {});
  }
});
`;

async function runChild(t, mode) {
  const child = spawn(process.execPath, [
    '--input-type=module',
    '--eval',
    fixture,
    mode,
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });

  const exited = once(child, 'close');
  const [message] = await once(child, 'message');
  assert.equal(message.ready, true);

  child.send('shutdown');
  const [code, signal] = await exited;
  return { code, signal, stderr, stdout };
}

test('idle service stops its timer and exits successfully', {
  timeout: 10000,
}, async t => {
  const result = await runChild(t, 'idle');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
});

test('unfinished HTTP request closes and process exits with failure status', {
  timeout: 10000,
}, async t => {
  const result = await runChild(t, 'busy');
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.signal, null);
});

test('already started background work can finish before process exit', {
  timeout: 10000,
}, async t => {
  const result = await runChild(t, 'background');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'synthetic-background-completed');
});