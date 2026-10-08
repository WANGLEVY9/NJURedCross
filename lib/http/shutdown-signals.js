export function registerShutdownSignals({
  server,
  shutdown,
  processTarget = process,
} = {}) {
  if (
    !server || typeof server.emit !== 'function'
    || !shutdown || typeof shutdown.stop !== 'function'
    || !processTarget || typeof processTarget.on !== 'function'
    || typeof processTarget.removeListener !== 'function'
  ) {
    throw new TypeError('Invalid shutdown signal options');
  }

  let stopping;

  function stop() {
    if (stopping) return stopping;

    stopping = Promise.resolve().then(async () => {
      // Stop scheduling new background work before closing HTTP.
      server.emit('shutdown');

      const result = await shutdown.stop();
      if (result.forced) processTarget.exitCode = 1;
      return result;
    });

    return stopping;
  }

  function handleSignal() {
    void stop().catch(() => {
      processTarget.exitCode = 1;
      console.error('Service shutdown failed; check pending operation state.');
    });
  }

  processTarget.on('SIGTERM', handleSignal);
  processTarget.on('SIGINT', handleSignal);

  function dispose() {
    processTarget.removeListener('SIGTERM', handleSignal);
    processTarget.removeListener('SIGINT', handleSignal);
  }

  return { stop, dispose };
}