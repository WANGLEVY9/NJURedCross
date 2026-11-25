import { createInterface } from 'node:readline';
import { correlateTelemetry, parseTelemetryLines } from './telemetry-trace-analysis.mjs';

// Read-only stdout analyzer for journalctl -o cat / -o json telemetry.
// It never echoes raw log lines, URLs, request bodies or identifiers other
// than the trace IDs and sanitized routes already present in the schema.
const numeric = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const traces = [];
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  traces.push(line);
  if (traces.length >= 200000) break;
}
const minMs = numeric(process.argv[2], 1000);
const limit = Math.min(100, Math.max(1, numeric(process.argv[3], 20)));
const records = parseTelemetryLines(traces);
console.log(JSON.stringify({ minMs, limit, ...correlateTelemetry(records, { minMs, limit }) }, null, 2));
