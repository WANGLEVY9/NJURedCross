/** GET-only personal-profile reader. No account-store access or mutation methods. */
import { ACTIVITY_TEST_BASE } from './activity-source.js';

export const MEMBERSHIP_SOURCE_TABLE = '个人主页（编辑版）';
const origin = 'https://table.nju.edu.cn';
const unverified = () => ({ status: 'unverified', department: '' });
function unavailable() { throw Object.assign(new Error('成员部门只读核验失败，请稍后重试。'), { code: 'material_membership_source_failed' }); }

export function createMaterialMembershipReader({ token, fetcher = fetch }) {
  async function get(url, credential) {
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Authorization: `Token ${credential}` },
        redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return unavailable();
      return await response.json();
    } catch { return unavailable(); }
  }
  // actor is supplied by the host's authenticated session, never by the application body.
  async function membershipFor(actor) {
    if (!actor?.id || actor.emailVerified !== true || typeof actor.studentId !== 'string' || !/^\d{6,20}$/.test(actor.studentId)) return unverified();
    if (!token) return unavailable();
    const auth = await get(`${origin}/api/v2.1/dtable/app-access-token/`, token);
    if (auth.dtable_uuid !== ACTIVITY_TEST_BASE || !auth.access_token) return unavailable();
    let endpoint;
    try {
      endpoint = auth.use_api_gateway ? `${origin}/api-gateway` : String(auth.dtable_server || '').replace(/\/$/, '');
      if (!endpoint || new URL(endpoint).origin !== origin) return unavailable();
    } catch { return unavailable(); }
    const root = `${endpoint}/api/${auth.use_api_gateway ? 'v2' : 'v1'}/dtables/${ACTIVITY_TEST_BASE}`;
    const metadata = await get(`${root}/metadata/`, auth.access_token);
    const table = (metadata.metadata || metadata).tables?.find(entry => entry.name === MEMBERSHIP_SOURCE_TABLE);
    if (!table?.columns?.some(column => column.name === '学号' && column.type === 'text')
      || !table.columns.some(column => column.name === '部门' && column.type === 'single-select')) return unavailable();
    const ids = new Set();
    let matches = 0, department = '';
    for (let start = 0; ; start += 100) {
      const url = new URL(`${root}/rows/`);
      for (const [key, value] of Object.entries({ table_name: MEMBERSHIP_SOURCE_TABLE, start, limit: 100, convert_keys: true })) url.searchParams.set(key, String(value));
      const page = await get(url, auth.access_token);
      if (!Array.isArray(page.rows) || page.rows.length > 100) return unavailable();
      for (const row of page.rows) {
        if (!row || typeof row._id !== 'string' || !row._id || ids.has(row._id)) return unavailable();
        ids.add(row._id);
        if (ids.size > 10000) return unavailable();
        if (typeof row['学号'] === 'string' && row['学号'].trim() === actor.studentId) {
          matches++;
          department = typeof row['部门'] === 'string' ? row['部门'].trim() : '';
        }
      }
      if (page.rows.length < 100) break;
    }
    // Duplicate profiles are never resolved by choosing a favourable department.
    return matches === 1 ? { status: 'verified', department } : unverified();
  }
  return Object.freeze({ membershipFor });
}
