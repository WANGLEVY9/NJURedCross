import { Base } from 'seatable-api';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
const tableName = '个人主页（编辑版）';

if (!token || token === 'replace-with-your-api-token') {
  console.error('Missing SEATABLE_VOLUNTEER_API_TOKEN. This command only reads table metadata.');
  process.exitCode = 1;
} else {
  try {
    const base = new Base({ server, APIToken: token });
    await base.auth();
    const metadata = await base.getMetadata();
    const table = (metadata?.tables || []).find((item) => item.name === tableName);
    if (!table) throw new Error('profile table not found');

    console.log(JSON.stringify({
      mode: 'preview',
      writes: false,
      base: 'volunteer',
      table: table.name,
      columnCount: table.columns?.length || 0,
      columns: (table.columns || []).map(({ name, type }) => ({ name, type })),
      nextStep: 'Review the field list and decide which fields are required, optional, sensitive, or out of scope.',
    }, null, 2));
  } catch {
    // SDK/network exceptions may include Authorization headers. Never print them.
    console.error('Unable to read profile table metadata. Check network access and the volunteer Base token; raw error details were suppressed.');
    process.exitCode = 1;
  }
}
