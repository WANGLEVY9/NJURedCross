/**
 * Prevent overlapping runs within one scheduler instance.
 * Stopping prevents new runs; an active operation is allowed to settle.
 */
export function startBackgroundTask(operation, {
  intervalMs,
  onError = () => {},
  runImmediately = true,
} = {}) {
  if (
    typeof operation !== 'function'
    || typeof onError !== 'function'
    || !Number.isSafeInteger(intervalMs)
    || intervalMs <= 0
    || intervalMs > 2_147_483_647
    || typeof runImmediately !== 'boolean'
  ) {
    throw new TypeError('Invalid background task configuration');
  }

  let running = false;
  let stopped = false;

  async function run() {
    if (stopped || running) return;

    running = true;
    try {
      await operation();
    } catch {
      // The logger receives no raw exception or private task payload.
      try {
        onError();
      } catch {
        // A logging failure must not leave the scheduler permanently busy.
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    void run();
  }, intervalMs);
  timer.unref();

  if (runImmediately) void run();

  return {
    run,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
