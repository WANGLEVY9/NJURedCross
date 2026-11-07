// Reconcile attendance evidence against business references and clean orphans.
// Usage: node --env-file=.env scripts/reconcile-attendance-evidence.mjs [--apply] [--include-local]
// Dry-run by default. Local files are only removed with --include-local AND when
// a verified Box copy exists; un-migrated local files are never deleted.
import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
const apply = process.argv.includes('--apply');
const includeLocal = process.argv.includes('--include-local');
assertCoordinatedMaintenance({ write: apply });
const { Base } = await import('seatable-api');
const { readdir, unlink } = await import('node:fs/promises');
const { join } = await import('node:path');
const { readPagedRows } = await import('../lib/http/paged-rows.js');
const { evidenceBoxConfig } = await import('../lib/events/attendance-photo.js');
const { openEvidenceStore } = await import('../lib/events/attendance-evidence-store.js');
const { deleteFile, boxStatus, NJUBOX_LIBRARIES } = await import('../lib/attachment/box.js');

const UUID = /^[a-f0-9-]{36}$/;
const directory = process.env.WORKFLOW_EVIDENCE_DIR?.trim()
  || (process.env.NODE_ENV === 'production' ? '/var/lib/njuredcross-evidence' : '.workflow-evidence');

try {
  const config = evidenceBoxConfig();
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  const token = process.env.SEATABLE_VOLUNTEER_API_TOKEN;
  const expected = process.env.SEATABLE_VOLUNTEER_BASE_UUID;
  if (!token || !expected) throw Error('Missing volunteer Base configuration');
  const base = new Base({ server, APIToken: token });
  await base.auth();
  if (base.dtableUuid !== expected) throw Error('Volunteer Base UUID mismatch');

  const rows = await readPagedRows(base, '网站活动报名总表', { pageSize: 1_000, maxRows: 100_000 });
  const referenced = new Set(rows.map(row => String(row['签到照片ID'] || '')).filter(id => UUID.test(id)));
  const store = await openEvidenceStore();
  const metadata = store.list();
  const localFiles = (await readdir(directory).catch(() => [])).filter(name => UUID.test(name));
  const boxOrphans = metadata.filter(row => row.provider === 'box' && !referenced.has(row.id));
  const localRetired = localFiles.filter(id => !referenced.has(id) && metadata.some(row => row.id === id && row.provider === 'box'));
  const localUnmigrated = localFiles.filter(id => !referenced.has(id) && !metadata.some(row => row.id === id && row.provider === 'box'));

  const report = {
    mode: apply ? 'apply' : 'preview', references: referenced.size,
    metadataRows: metadata.length, localFiles: localFiles.length,
    boxOrphans: boxOrphans.length, localRetired: localRetired.length,
    localUnmigratedOrphans: localUnmigrated.length,
    deletedBox: 0, deletedLocal: 0, removedMetadata: 0,
    failed: [], includeLocal, businessRowWrites: 0,
  };
  if (apply) {
    if (!boxStatus(config).configured && boxOrphans.length) throw Error('NJU Box 主库令牌未配置');
    for (const row of boxOrphans) {
      try {
        await deleteFile(config, row.path, NJUBOX_LIBRARIES.main);
        store.remove(row.id);
        report.deletedBox += 1;
        report.removedMetadata += 1;
      } catch (error) { report.failed.push({ id: row.id, code: error?.code || 'delete_failed' }); }
    }
    if (includeLocal) {
      for (const id of localRetired) {
        try { await unlink(join(directory, id)); report.deletedLocal += 1; }
        catch (error) { report.failed.push({ id, code: error?.code || 'unlink_failed' }); }
      }
    }
  }
  store.close();
  console.log(JSON.stringify(report));
  if (apply && report.failed.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error?.message || 'reconciliation unavailable' }));
  process.exitCode = 1;
}
