import { assertRequestActive } from './request-budget.js';

/**
 * Preserve result order while bounding concurrent operations.
 * On failure, stop admission and wait for active operations to settle.
 */
export async function mapConcurrent(items, concurrency, operation) {
  if (
    !Array.isArray(items)
    || !Number.isSafeInteger(concurrency)
    || concurrency < 1
    || concurrency > 32
    || typeof operation !== 'function'
  ) {
    throw new TypeError('Invalid concurrent mapping configuration');
  }

  assertRequestActive();

  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure;

  async function worker() {
    while (!failed && next < results.length) {
      const index = next++;

      try {
        assertRequestActive();
        results[index] = await operation(items[index], index);
        assertRequestActive();
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );

  await Promise.all(workers);

  if (failed) throw failure;
  assertRequestActive();

  return results;
}