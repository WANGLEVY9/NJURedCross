import { portalSection } from './navigation.js';

// Temporary presentation rollout. Remove a section here when it opens to all
// visitors. Server-side API permissions remain the authority for real data.
export const DEVELOPING_PLAZAS = Object.freeze({
  '/outreach': '宣传广场',
  '/community': '内建广场',
  '/materials': '财务物资广场',
});

export function developingPlaza(path) {
  const section = portalSection(path);
  return DEVELOPING_PLAZAS[section] ? { section, name: DEVELOPING_PLAZAS[section] } : null;
}
