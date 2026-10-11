import { communityModuleNav } from '../community-nav.js';
import { birthdayAvailable, lastKnownAvailability } from '../../portal/pages/warmth.js';

const loadBirthday = () => import('./community-birthday.js');
const loadLegacy = () => import('./community-legacy.js');

/**
 * Preserve main's existing flow until the production schema is ready. Like the
 * public plaza, the console renders the branch it last saw without waiting for
 * the capability round trip and lets the answer correct it, so the module graph
 * is the only thing on the critical path.
 */
export default async function page(...args) {
  const legacyRoute = new URL(location.href).searchParams.get('program') === 'morning';
  const mount = async (branch) => {
    const module = await (branch === 'birthday' ? loadBirthday() : loadLegacy());
    const result = await module.default(...args);
    result.node.prepend(communityModuleNav('birthday'));
    return result;
  };

  const assumed = legacyRoute || lastKnownAvailability() === false ? 'legacy' : 'birthday';
  let current = await mount(assumed);

  if (!legacyRoute) {
    birthdayAvailable().then(async (enabled) => {
      const confirmed = enabled ? 'birthday' : 'legacy';
      if (confirmed === assumed || !current.node.isConnected) return;
      const next = await mount(confirmed);
      if (!current.node.isConnected) { next.dispose?.(); return; }
      current.node.replaceWith(next.node);
      current.dispose?.();
      current = next;
    }).catch(() => {});
  }

  return { ...current, dispose() { current.dispose?.(); } };
}
