import { birthdayAvailable } from '../warmth-rollout.js';

/** Preserve main's existing flow until the production schema is ready. */
export default async function page(...args) {
  const enabled = await birthdayAvailable();
  const module = await import(enabled ? './me-birthday.js' : './me-legacy.js');
  return module.default(...args);
}
