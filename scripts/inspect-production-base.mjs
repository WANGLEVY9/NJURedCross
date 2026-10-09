/** Metadata and COUNT(*) only; deliberately no credentials, record values or writes in output. */
import { Base } from 'seatable-api';
const productionBases = {
  management: '076b49ed-6f04-4ea6-8799-1b9ad71dba88',
  volunteer: 'cc304b1d-a726-4f92-a9be-a6ffcaa54038',
  identity: '3f593da5-e315-4c54-88f2-03c50fa716aa',
};
const kind = process.argv.find(arg => arg.startsWith('--base='))?.slice(7);
try {
  if (!productionBases[kind] || process.env.SEATABLE_BUSINESS_BASE_UUID !== productionBases[kind]) throw new Error('production_base_configuration_mismatch');
  const server = process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn';
  if (new URL(server).origin !== 'https://table.nju.edu.cn') throw new Error('production_server_mismatch');
  if (!process.env.SEATABLE_API_TOKEN) throw new Error('api_token_missing');
  const base = new Base({ server, APIToken: process.env.SEATABLE_API_TOKEN });
  await base.auth();
  if (base.dtableUuid !== productionBases[kind]) throw new Error('authenticated_base_mismatch');
  const metadata = await base.getMetadata();
  const tables = [];
  for (const table of metadata.tables || []) {
    let rowCount = null;
    try {
      const result = await base.query('SELECT COUNT(*) AS total FROM `' + table.name.replaceAll('`', '``') + '`');
      const total = result?.[0]?.total;
      if (total !== undefined && total !== null && Number.isFinite(Number(total))) rowCount = Number(total);
    } catch { /* A denied aggregate does not authorize reading actual records as a fallback. */ }
    tables.push({
      name: table.name, rowCount,
      columns: table.columns.map(column => {
        const endpoints = [column.data?.table_id, column.data?.other_table_id];
        const target = column.type === 'link' ? endpoints.find(id => id && id !== table._id) : null;
        return { name: column.name, type: column.type, linkedTable: metadata.tables.find(other => other._id === target)?.name || null };
      }),
    });
  }
  console.log(JSON.stringify({ ok: true, mode: 'read-only', rowWrites: 0, kind, uuid: base.dtableUuid, checkedAt: new Date().toISOString(), tableCount: tables.length, tables }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.response ? 'njutable_request_failed' : error.message, status: error.response?.status || null }));
  process.exitCode = 1;
}
