import { communityModuleNav } from '../community-nav.js';
import { birthdayAvailable, lastKnownAvailability } from '../../portal/warmth-rollout.js';

const loadBirthday = () => import('./community-birthday.js');
const loadLegacy = () => import('./community-legacy.js');

/** Preserve main's existing flow until the production schema is ready. */
export default async function page(...args) {
  // Start the likely module now; the capability check still decides the view.
  const legacyRoute = new URL(location.href).searchParams.get('program') === 'morning';
  const guess = !legacyRoute && lastKnownAvailability() !== false ? loadBirthday : loadLegacy;
  const prefetched = guess();
  const enabled = !legacyRoute && await birthdayAvailable();
  const load = enabled ? loadBirthday : loadLegacy;
  const module = await (load === guess ? prefetched : load());
  const page=await module.default(...args);page.node.prepend(communityModuleNav('birthday'));return page;
}
