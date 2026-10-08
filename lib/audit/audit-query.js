/** Fixed table and field; unusual legacy IDs use the complete-read path. */
export function buildAuditEvidenceQuery(auditId) {
  if (
    typeof auditId !== 'string'
    || !auditId
    || auditId.length > 200
    || !/^[A-Za-z0-9_-]+$/.test(auditId)
  ) {
    return null;
  }

  return [
    'SELECT * FROM `操作审计表`',
    `WHERE \`审计ID\` = '${auditId}'`,
    'ORDER BY `_id`',
    'LIMIT 2',
  ].join(' ');
}

function unavailable() {
  return Object.assign(
    new Error('审计候选记录无法可靠读取，已停止核对。'),
    { code: 'audit_query_unavailable', statusCode: 503 },
  );
}

/** null requests the existing complete-read compatibility path. */
export async function readAuditCandidates(client, auditId) {
  const sql = buildAuditEvidenceQuery(auditId);

  if (sql === null || typeof client?.query !== 'function') {
    return null;
  }

  try {
    const rows = await client.query(sql);

    if (
      !Array.isArray(rows)
      || rows.length > 2
      || rows.readMeta?.truncated
    ) {
      throw unavailable();
    }

    const seen = new Set();

    for (const row of rows) {
      if (
        !row
        || typeof row !== 'object'
        || Array.isArray(row)
        || typeof row._id !== 'string'
        || !row._id
        || seen.has(row._id)
        || row['审计ID'] !== auditId
      ) {
        throw unavailable();
      }

      seen.add(row._id);
    }

    return rows;
  } catch {
    throw unavailable();
  }
}