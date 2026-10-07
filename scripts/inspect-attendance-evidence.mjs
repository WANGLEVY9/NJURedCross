import { Base } from 'seatable-api';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_WORKFLOW_BASE } from '../lib/events/workflow-mode.js';
import { inspectAttendanceEvidence } from '../lib/events/evidence-inspection.js';
import { readEvidenceDirectory } from '../lib/events/evidence-directory.js';
import { readPagedRows } from '../lib/http/paged-rows.js';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

try {
  if (process.argv.slice(2).length !== 0) {
    throw new Error('Unsupported arguments');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Test environment only');
  }

  const server = process.env.SEATABLE_SERVER_URL?.trim();
  const token = process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
  const expectedUuid = process.env.SEATABLE_VOLUNTEER_BASE_UUID?.trim();
  const directory = process.env.WORKFLOW_EVIDENCE_DIR?.trim();

  if (
    !server || !token
    || expectedUuid !== TEST_WORKFLOW_BASE
    || !directory || !isAbsolute(directory)
  ) {
    throw new Error('Explicit test Base and absolute evidence directory required');
  }

  const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
  const insidePublic = relative(publicDirectory, resolve(directory));
  if (
    insidePublic === ''
    || (!isAbsolute(insidePublic)
      && insidePublic !== '..'
      && !insidePublic.startsWith(`..${sep}`))
  ) {
    throw new Error('Evidence directory cannot be public');
  }

  installSeaTableTransport();

  const report = await withRequestBudget(async () => {
    const base = new Base({ server, APIToken: token });
    await base.auth();

    if (base.dtableUuid !== expectedUuid) {
      throw new Error('Authenticated Base UUID mismatch');
    }

    return inspectAttendanceEvidence({
      loadRegistrations: () => readPagedRows(
        base,
        '网站活动报名总表',
        {
          pageSize: 500,
          maxRows: 100000,
          requireComplete: true,
        },
      ),
      loadDirectory: () => readEvidenceDirectory(directory),
    });
  });

  console.log(JSON.stringify({
    mode: report.mode,
    writes: report.writes,
    deletes: report.deletes,
    deletionAuthorized: report.deletionAuthorized,
    atomicSnapshot: report.atomicSnapshot,
    baseUuidMatches: true,
    counts: report.counts,
    ignoredDirectoryEntries: report.ignoredDirectoryEntries,
    sampleLimit: 20,
    missingSample: report.missing.slice(0, 20),
    unreferencedSample: report.unreferenced.slice(0, 20),
    samplesLimited: report.missing.length > 20
      || report.unreferenced.length > 20,
  }, null, 2));
} catch {
  console.error(
    '签到照片只读核查未完成。请检查测试 Base、UUID、完整报名表及明确指定的私有目录。未执行写入或删除。',
  );
  process.exitCode = 1;
}