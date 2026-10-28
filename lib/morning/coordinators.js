import { assertRequestActive } from '../http/request-budget.js';

export const MORNING_COORDINATOR_TABLE = '全体成员表（26~27学年）';

// Fixed people selected by the owner, pinned to the verified roster records.
// Email addresses stay in SeaTable and are reread before each notification.
export const MORNING_COORDINATORS = Object.freeze({
  nanjing: Object.freeze([
    Object.freeze({ name: '金中宸', rowId: 'M_gms8D5R9uuJ10VLCTxbw' }),
    Object.freeze({ name: '袁金雨', rowId: 'SHBqILDXR72igILTwLS0-Q' }),
    Object.freeze({ name: '邹孟窈', rowId: 'K88gvBe9TwqingDS2o326w' }),
    Object.freeze({ name: '张蒙', rowId: 'QzjkzVcNQVqqd4zJu2U6ew' }),
    Object.freeze({ name: '毕诗语', rowId: 'GnCRk6x2QVuS3Hdxgb4tTA' }),
  ]),
  suzhou: Object.freeze([
    Object.freeze({ name: '李婉荣', rowId: 'V_HeMiivQq-ISzt-jINjkA' }),
    Object.freeze({ name: '陈芷馨', rowId: 'A368u7XcTWW0Q4pj6CWGNA' }),
  ]),
});

function unavailable() {
  return Object.assign(new Error('报备收件人名册暂不可用，请联系管理员核对姓名和校园邮箱。'), {
    statusCode: 503, code: 'morning_coordinators_unavailable',
  });
}

/** Read only the fixed records and selected contact fields; never scan identity data. */
export async function readMorningInviteCoordinators(client, campus) {
  const normalizedCampus = String(campus || '').trim().replace(/校区$/, '');
  if (!['鼓楼', '仙林', '浦口', '苏州'].includes(normalizedCampus) || typeof client?.query !== 'function') throw unavailable();
  const people = MORNING_COORDINATORS[normalizedCampus === '苏州' ? 'suzhou' : 'nanjing'];
  const ids = people.map(person => `'${person.rowId}'`).join(',');
  let rows;
  assertRequestActive();
  try {
    rows = await client.query(`SELECT \`_id\`, \`姓名\`, \`邮箱\` FROM \`${MORNING_COORDINATOR_TABLE}\` WHERE \`_id\` IN (${ids}) LIMIT ${people.length + 1}`);
  } catch {
    assertRequestActive();
    throw unavailable();
  }
  assertRequestActive();
  if (!Array.isArray(rows) || rows.readMeta?.truncated || rows.length !== people.length) throw unavailable();
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row._id !== 'string' || byId.has(row._id) || !people.some(person => person.rowId === row._id)) throw unavailable();
    byId.set(row._id, row);
  }
  const emails = people.map(person => {
    const row = byId.get(person.rowId);
    if (String(row?.['姓名'] || '').trim() !== person.name || typeof row?.['邮箱'] !== 'string') throw unavailable();
    const email = row['邮箱'].trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._+-]*@(?:smail\.)?nju\.edu\.cn$/.test(email)) throw unavailable();
    return email;
  });
  return [...new Set(emails)];
}
