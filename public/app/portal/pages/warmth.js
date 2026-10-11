import { birthdayAvailable, lastKnownAvailability } from '../warmth-rollout.js';

/**
 * The birthday view reaches its own dependencies through two more import levels.
 * A browser only discovers them as each level arrives, so on a slow link the
 * graph costs one round trip per level. Issuing them together with the page
 * module flattens that to a single level; the module map then hands the page its
 * already-fetched copies.
 */
const loadBirthday = () => Promise.all([
  import('./warmth-birthday.js'),
  import('../auth-gate.js'),
  import('../blessing-drawer.js'),
  import('../blessing-letter.js'),
  import('../blessing-actions.js'),
  import('../warmth-panels.js'),
  import('../warmth-options.js'),
]).then(([module]) => module);
const loadLegacy = () => import('./warmth-legacy.js');

/**
 * Preserve main's existing flow until the production schema is ready.
 *
 * The capability check and the page module used to run one after the other, so
 * entering 内建广场 paid a round trip before the module graph even started. The
 * branch seen most recently now starts downloading immediately while the check
 * is in flight; the confirmed answer still decides which view renders, and a
 * wrong guess costs the same as before because the module map dedupes imports.
 */
export default async function page(...args) {
  const guess = lastKnownAvailability() === false ? loadLegacy : loadBirthday;
  const prefetched = guess();
  const enabled = await birthdayAvailable();
  const load = enabled ? loadBirthday : loadLegacy;
  const module = await (load === guess ? prefetched : load());
  return module.default(...args);
}
