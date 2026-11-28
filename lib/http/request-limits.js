/** Shared request-size and concurrency guards for the single Node process. */

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const DEFAULT_UPLOAD_BODY_LIMIT_BYTES = 200 * 1024 * 1024;
const MAX_BODY_LIMIT_BYTES = 220 * 1024 * 1024;

// Attendance sends a raw image Blob, not multipart or JSON. Its outer gate
// must not depend on timeout configuration or optional server-entry wiring.
// The evidence reader still applies the configured 1–20 MiB limit and validates
// the image before saving it; this is only the bounded transport ceiling.
export function attendanceBodyLimitsFor(method, pathname) {
  if (String(method).toUpperCase() !== 'POST'
    || !/^\/api\/(?:portal|volunteer)\/workflow\/registrations\/[^/]+\/attendance$|^\/api\/volunteer\/workflow\/registrations\/[^/]+\/attendance-supplement$|^\/api\/portal\/workflow\/events\/[^/]+\/registry-certificate$/.test(pathname)) return undefined;
  return { uploadMaxBytes: 20 * 1024 * 1024, allowNonMultipartUpload: true };
}

function rejection(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function contentLengthOf(req) {
  const raw = req?.headers?.['content-length'];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw rejection('Request body length is invalid', 400, 'invalid_content_length');
  }
  return value;
}

/**
 * Reject oversized bodies before a stream is consumed. The body readers still
 * enforce their own byte limits; this gate covers direct Node access and
 * multipart handlers.
 */
export function assertRequestBodySize(req, { jsonMaxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
  uploadMaxBytes = DEFAULT_UPLOAD_BODY_LIMIT_BYTES,
  allowNonMultipartUpload = false } = {}) {
  for (const limit of [jsonMaxBytes, uploadMaxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BODY_LIMIT_BYTES) {
      throw new TypeError('Request body limit must be a positive integer');
    }
  }
  const declared = contentLengthOf(req);
  if (declared === null) return;
  const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
  const maxBytes = contentType.startsWith('multipart/form-data')
    || allowNonMultipartUpload
    ? uploadMaxBytes
    : jsonMaxBytes;
  if (declared > maxBytes) throw rejection('Request body is too large', 413, 'request_body_too_large');
}

/** FIFO admission gate; excess requests fail fast with a bounded 503. */
export function createRequestConcurrencyGate({ limit = 32, queueLimit = 64 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024
    || !Number.isSafeInteger(queueLimit) || queueLimit < 0 || queueLimit > 4096) {
    throw new TypeError('Invalid request concurrency options');
  }
  let active = 0;
  const waiting = [];

  function release() {
    active--;
    const next = waiting.shift();
    if (!next) return;
    active++;
    Promise.resolve().then(next);
  }

  return {
    async run(operation) {
      if (active >= limit) {
        if (waiting.length >= queueLimit) {
          throw rejection('Service is busy; please retry shortly', 503, 'request_queue_full');
        }
        await new Promise(resolve => waiting.push(resolve));
      } else {
        active++;
      }
      try {
        return await operation();
      } finally {
        release();
      }
    },
    stats() {
      return { active, queued: waiting.length, limit, queueLimit };
    },
  };
}
