// Run one Playwright shard and retry only infrastructure failures.
// Deterministic assertion failures are reported immediately with a JSON report
// so Quality gate can summarize the exact spec and error.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collectFailures, failureSummary, isInfrastructureError } from './ci-quality-report.mjs';

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage: node scripts/run-browser-shard.mjs <playwright args...>');
  process.exit(2);
}

const directory = mkdtempSync(join(tmpdir(), 'njurc-browser-shard-'));
const reportPath = join(directory, 'report.json');

function run(attempt) {
  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath };
  const result = spawnSync('npx', ['playwright', 'test', ...args, '--reporter=json'], {
    stdio: 'inherit',
    env,
  });
  let report = null;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch { /* A launch failure may leave no JSON report. */ }
  const failures = collectFailures(report);
  const infrastructure = result.status !== 0 && (
    !report ||
    result.error ||
    !failures.length ||
    failures.every(failure => failure.infrastructure) ||
    isInfrastructureError(report.errors)
  );
  console.log(`[browser-shard] attempt ${attempt}: status=${result.status}, failures=${failures.length}, infrastructure=${infrastructure ? 'yes' : 'no'}`);
  for (const line of failureSummary(failures)) console.log(`[browser-shard] ${line}`);
  return { status: result.status, failures, infrastructure };
}

let outcome = run(1);
if (outcome.status !== 0 && outcome.infrastructure) {
  console.log('[browser-shard] infrastructure failure; retrying the shard once');
  outcome = run(2);
}

// Persist a compact machine-readable summary for the Quality gate job.
const evidencePath = resolve(process.env.BROWSER_SHARD_SUMMARY || 'test-results/browser-shard-summary.json');
mkdirSync(resolve(evidencePath, '..'), { recursive: true });
writeFileSync(evidencePath, JSON.stringify({
  attempt: outcome.status !== 0 && outcome.infrastructure ? 2 : 1,
  failed: outcome.status !== 0,
  infrastructure: outcome.infrastructure,
  failures: outcome.failures,
}, null, 2));
console.log(`[browser-shard] evidence: ${evidencePath}`);

if (process.env.GITHUB_STEP_SUMMARY && outcome.status !== 0) {
  const lines = ['### Browser shard failure', ...failureSummary(outcome.failures)];
  if (!outcome.failures.length) lines.push('- No JSON test result; check browser launch and runner logs.');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

rmSync(directory, { recursive: true, force: true });
process.exitCode = outcome.status === 0 ? 0 : 1;
