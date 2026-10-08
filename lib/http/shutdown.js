export function createHttpShutdown(server, {
  timeoutMs = 10000,
} = {}) {
  if (
    !server
    || typeof server.on !== 'function'
    || typeof server.close !== 'function'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > 2147483647
  ) {
    throw new TypeError('Invalid HTTP shutdown options');
  }

  const sockets = new Set();
  let stopping = false;
  let stopped;
  let timer;

  function track(socket) {
    if (stopping) {
      socket.destroy();
      return;
    }

    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  }

  server.on('connection', track);

  function stop() {
    if (stopped) return stopped;
    stopping = true;

    stopped = new Promise((resolve, reject) => {
      let settled = false;

      function finish(error, forced) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (error) {
          reject(new Error('HTTP shutdown failed'));
        } else {
          resolve({ forced });
        }
      }

      timer = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections?.();
        finish(null, true);
      }, timeoutMs);

      try {
        server.close(error => {
          if (error?.code === 'ERR_SERVER_NOT_RUNNING') {
            finish(null, false);
          } else {
            finish(error, false);
          }
        });

        server.closeIdleConnections?.();
      } catch (error) {
        finish(error, false);
      }
    });

    return stopped;
  }

  return { stop };
}
/** Register synchronous scheduling cleanup; run it at most once. */
export function registerShutdownCleanup(server, cleanup) {
  if (
    !server
    || typeof server.once !== 'function'
    || typeof server.removeListener !== 'function'
    || typeof cleanup !== 'function'
  ) {
    throw new TypeError('Invalid shutdown cleanup');
  }

  let completed = false;

  function run() {
    if (completed) return;
    completed = true;
    server.removeListener('shutdown', run);
    server.removeListener('close', run);

    try {
      cleanup();
    } catch {
      console.error('Background scheduling shutdown failed.');
    }
  }

  server.once('shutdown', run);
  server.once('close', run);
}