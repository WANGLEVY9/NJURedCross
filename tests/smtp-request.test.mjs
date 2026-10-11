import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { sendSmtpMail } from '../lib/http/smtp-request.js';

const message = {
  from: 'sender@example.test',
  to: 'recipient@example.test',
  subject: 'synthetic',
  text: 'synthetic-content',
};

async function fixture(t, handler) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    handler(socket);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    for (const socket of sockets) socket.destroy();
    await closed;
  });

  return {
    host: '127.0.0.1',
    port: server.address().port,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  };
}

test('SMTP sends successfully through its dedicated connection', async t => {
  let content = '';
  const disconnected = Promise.withResolvers();
  const options = await fixture(t, socket => {
    socket.on('close', () => disconnected.resolve());
    socket.write('220 synthetic SMTP ready\r\n');

    let buffer = '';
    let receivingData = false;

    socket.on('data', chunk => {
      buffer += chunk.toString();
      let newline;

      while ((newline = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);

        if (receivingData) {
          if (line === '.') {
            receivingData = false;
            socket.write('250 accepted\r\n');
          } else {
            content += line + '\n';
          }
          continue;
        }

        if (/^(EHLO|HELO) /i.test(line)) {
          socket.write('250 synthetic\r\n');
        } else if (/^(MAIL FROM|RCPT TO):/i.test(line)) {
          socket.write('250 ok\r\n');
        } else if (line === 'DATA') {
          receivingData = true;
          socket.write('354 send message\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });

  const result = await sendSmtpMail(options, message, { timeoutMs: 3000 });

  assert.deepEqual(result.accepted, ['recipient@example.test']);
  assert.match(content, /synthetic-content/);
  await disconnected.promise;
});

test('SMTP deadline closes a connection waiting for a greeting', async t => {
  let connections = 0;
  const disconnected = Promise.withResolvers();
  const options = await fixture(t, socket => {
    connections++;
    socket.on('close', () => disconnected.resolve());
    // No greeting: simulate a stalled mail server.
  });

  await assert.rejects(
    sendSmtpMail(options, message, { timeoutMs: 500 }),
    error => error.code === 'external_request_timeout',
  );

  await disconnected.promise;
  assert.equal(connections, 1);
});

test('SMTP caller cancellation closes only its operation socket', async t => {
  const connected = Promise.withResolvers();
  const disconnected = Promise.withResolvers();
  const options = await fixture(t, socket => {
    socket.on('close', () => disconnected.resolve());
    connected.resolve();
  });

  const controller = new AbortController();
  const operation = sendSmtpMail(options, message, {
    timeoutMs: 5000,
    signal: controller.signal,
  });
  const rejected = assert.rejects(
    operation,
    error => error.code === 'external_request_cancelled',
  );

  await connected.promise;
  controller.abort();

  await rejected;
  await disconnected.promise;
});
test('implicit TLS handshake timeout closes its socket', async t => {
  const disconnected = Promise.withResolvers();
  const options = await fixture(t, socket => {
    socket.on('close', () => disconnected.resolve());
    socket.on('data', () => {});
    // Accept TCP but never complete the TLS handshake.
  });

  await assert.rejects(
    sendSmtpMail({
      ...options,
      secure: true,
      ignoreTLS: false,
    }, message, { timeoutMs: 500 }),
    error => error.code === 'external_request_timeout',
  );

  await disconnected.promise;
});

test('STARTTLS handshake timeout closes its socket', async t => {
  const disconnected = Promise.withResolvers();
  const options = await fixture(t, socket => {
    socket.on('close', () => disconnected.resolve());
    socket.write('220 synthetic SMTP ready\r\n');

    let buffer = '';
    let upgrading = false;
    socket.on('data', chunk => {
      if (upgrading) return;
      buffer += chunk.toString();
      let newline;

      while ((newline = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);

        if (/^EHLO /i.test(line)) {
          socket.write('250-synthetic\r\n250 STARTTLS\r\n');
        } else if (line === 'STARTTLS') {
          upgrading = true;
          socket.write('220 begin TLS\r\n');
          return;
        }
      }
    });
  });

  await assert.rejects(
    sendSmtpMail({
      ...options,
      ignoreTLS: false,
      requireTLS: true,
    }, message, { timeoutMs: 500 }),
    error => error.code === 'external_request_timeout',
  );

  await disconnected.promise;
});