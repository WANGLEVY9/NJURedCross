import { request } from '../core/api.js';

/** Old deployments and incomplete production schemas retain main's existing UI. */
export async function birthdayAvailable() {
  try {
    const result = await request('/api/public/warmth/capabilities');
    return result.birthday?.enabled === true && result.birthday?.ready === true;
  } catch { return false; }
}
