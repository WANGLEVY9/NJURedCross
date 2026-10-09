import { birthdayAvailable } from '../../portal/warmth-rollout.js';

/** Preserve main's existing flow until the production schema is ready. */
export default async function page(...args) {
  const enabled = new URL(location.href).searchParams.get('program') !== 'morning' && await birthdayAvailable();
  const module = await import(enabled ? './community-birthday.js' : './community-legacy.js');
  return module.default(...args);
}
