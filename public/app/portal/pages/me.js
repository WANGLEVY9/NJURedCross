import { birthdayAvailable } from './warmth.js';

/**
 * Preserve main's existing flow until the production schema is ready. Only an
 * explicit "not enabled" answer switches to the legacy page: a check that
 * could not be made (`null`) keeps the deployed view instead of guessing.
 */
export default async function page(...args) {
  const enabled = await birthdayAvailable();
  const module = await import(enabled === false ? './me-legacy.js' : './me-birthday.js');
  return module.default(...args);
}
