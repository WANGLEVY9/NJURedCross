// Guard browser regressions against viewport assertions that are unstable when
// the target lives in an internal scroll container.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = new URL('../tests/browser/', import.meta.url);
export const EXEMPT = 'browser-contract-allow-viewport';
export const MARKERS = [
  /\.activity-final-hours-table\b/,
  /\.activity-hours-progress__body\b/,
  /\.modal__body\b/,
  /\.activity-v2-detail\b/,
  /\.activity-registration-content\b/,
  /\.activity-draft-table\b/,
  /\.service-table-scroll\b/,
];

export function inspectSpec(name, source) {
  const lines = source.split('\n');
  const findings = [];
  lines.forEach((line, index) => {
    if (!line.includes('toBeInViewport(') || line.includes(EXEMPT)) return;
    // The exemption may be documented immediately before a multiline assertion.
    if (lines.slice(Math.max(0, index - 2), index).some(previous => previous.includes(EXEMPT))) return;
    const prefix = lines.slice(Math.max(0, index - 12), index).join('\n');
    if (!MARKERS.some(marker => marker.test(prefix) || marker.test(line))) return;
    findings.push(`tests/browser/${name}:${index + 1} - internal scroll container assertion must use container geometry, not page toBeInViewport`);
  });
  return findings;
}

export function inspectBrowserSpecs(readDirectory = readdirSync, readFile = readFileSync) {
  const files = readDirectory(ROOT).filter(name => name.endsWith('.spec.mjs'));
  const findings = files.flatMap(name => inspectSpec(name, readFile(join(fileURLToPath(ROOT), name), 'utf8')));
  return { files, findings };
}

if (process.argv[1]?.endsWith('check-browser-contracts.mjs')) {
  const { files, findings } = inspectBrowserSpecs();
  if (findings.length) {
    console.error(findings.join('\n'));
    console.error(`Add // ${EXEMPT}: <reason> when a page-level assertion is intentional.`);
    process.exitCode = 1;
  } else {
    console.log(`Browser contracts verified (${files.length} specs).`);
  }
}
