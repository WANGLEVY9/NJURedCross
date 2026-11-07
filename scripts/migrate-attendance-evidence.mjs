// Move historic attendance photos from the private local directory into NJU Box.
// Usage: node --env-file=.env scripts/migrate-attendance-evidence.mjs [--apply]
// Dry-run by default. Local originals are retained for rollback; use
// reconcile-attendance-evidence.mjs --apply to remove confirmed copies later.
import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
const apply = process.argv.includes('--apply');
assertCoordinatedMaintenance({ write: apply });
const { Base } = await import('seatable-api');
const { readdir, readFile } = await import('node:fs/promises');
const { join } = await import('node:path');
const { createHash } = await import('node:crypto');
const { readPagedRows } = await import('../lib/http/paged-rows.js');
const {
  attendanceRoot, attendanceBoxPath, evidenceBoxConfig, photoType,
} = await import('../lib/events/attendance-photo.js');
const { openEvidenceStore } = await import('../lib/events/attendance-evidence-store.js');
const { uploadBuffer, downloadBuffer, boxStatus, NJUBOX_LIBRARIES } = await import('../lib/attachment/box.js');

const UUID = /^[a-f0-9-]{36}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = process.env.WORKFLOW_EVIDENCE_DIR?.trim()
  || (process.env.NODE_ENV === 'production' ? '/var/lib/njuredcross-evidence' : '.workflow-evidence');

try {
  const config = evidenceBoxConfig();
  if (!boxStatus(config).configured) throw Error('NJU Box 主库令牌未配置');
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  const token = process.env.SEATABLE_VOLUNTEER_API_TOKEN;
  const expected = process.env.SEATABLE_VOLUNTEER_BASE_UUID;
  if (!token || !expected) throw Error('Missing volunteer Base configuration');
  const base = new Base({ server, APIToken: token });
  await base.auth();
  if (base.dtableUuid !== expected) throw Error('Volunteer Base UUID mismatch');

  const rows = await readPagedRows(base, '网站活动报名总表', { pageSize: 1_000, maxRows: 100_000 });
  const byPhoto = new Map(rows.filter(row => UUID.test(String(row['签到照片ID'] || '')))
    .map(row => [String(row['签到照片ID']), row]));
  const files = (await readdir(directory).catch(() => [])).filter(name => UUID.test(name));
  const store = await openEvidenceStore();
  const report = {
    mode: apply ? 'apply' : 'preview', root: attendanceRoot(), directory,
    registrations: rows.length, localFiles: files.length, linked: 0,
    alreadyInBox: 0, planned: 0, uploaded: 0, verified: 0, failed: [],
    localOriginalsRetained: true, businessRowWrites: 0,
  };

  for (const id of files) {
    const existing = store.get(id);
    if (existing?.provider === 'box') { report.alreadyInBox += 1; continue; }
    const row = byPhoto.get(id);
    if (row) report.linked += 1;
    const context = {
      eventId: row?.['活动ID'] || '', registrationCode: row?.['报名ID'] || '',
      studentId: row?.['学号'] || '', date: row?.['报名日期'] || '',
    };
    const bytes = await readFile(join(directory, id));
    const mime = photoType(bytes);
    const { relativePath, filename } = attendanceBoxPath(context, id, mime);
    if (!apply) { report.planned += 1; continue; }
    try {
      const uploaded = await uploadBuffer(config, {
        dir: attendanceRoot(), relativePath, filename, buffer: bytes, contentType: mime,
      });
      report.uploaded += 1;
      const readBack = await downloadBuffer(config, uploaded.path, NJUBOX_LIBRARIES.main, { maxBytes: 20 * 1024 * 1024 });
      if (sha(readBack) !== sha(bytes)) throw Error('Box read-back checksum mismatch');
      report.verified += 1;
      store.record({
        id, provider: 'box', path: uploaded.path, bytes: bytes.length, mime, sha256: sha(bytes),
        event_id: context.eventId, registration_code: context.registrationCode,
        student_id: context.studentId, created_at: new Date().toISOString(),
      });
    } catch (error) {
      report.failed.push({ id, code: error?.code || error?.message || 'upload_failed' });
    }
  }
  store.close();
  console.log(JSON.stringify(report));
  if (apply && report.failed.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ ok: false, message: error?.message || 'migration unavailable' }));
  process.exitCode = 1;
}
