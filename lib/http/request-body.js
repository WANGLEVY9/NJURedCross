import {
  assertRequestActive,
  currentRequestBudget,
} from './request-budget.js';

export async function collectRequestBody(req, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('Body size limit must be a positive integer');
  }

  assertRequestActive();
  const budget = currentRequestBudget();
  const abort = () => req.destroy(budget.signal.reason);

  budget?.signal.addEventListener('abort', abort, { once: true });

  try {
    const chunks = [];
    let size = 0;

    for await (const chunk of req) {
      assertRequestActive();
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('Request body is too large');
        error.statusCode = 413;
        throw error;
      }
      chunks.push(chunk);
    }

    assertRequestActive();
    return Buffer.concat(chunks);
  } finally {
    budget?.signal.removeEventListener('abort', abort);
  }
}