import { h } from '../../core/dom.js';
import { errorState } from '../../ui/primitives.js';
import { birthdayAvailable, lastKnownAvailability } from '../warmth-rollout.js';
import { warmthPreview } from '../warmth-preview.js';

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
 * The capability check decides between the birthday and the legacy view, but
 * waiting for it kept the whole page off screen until a second round trip had
 * finished. 内建广场 now renders the branch it last saw as soon as that module
 * arrives, and the answer only corrects it: a deployment with the pilot off
 * swaps to the legacy view when the check disagrees, while the deployed
 * configuration never swaps at all. The branch seen most recently also decides
 * which module graph is fetched, so a wrong guess only costs a second import
 * that the module map dedupes.
 */
export default function page(context, shell) {
  const host = warmthPreview();
  let mounted = null;
  let generation = 0;
  let disposed = false;

  const failed = (error) => {
    // A failed correction leaves the view that is already on screen; only the
    // first mount has nowhere to fall back to.
    if (disposed || mounted || !host.isConnected) return;
    host.replaceChildren(h('div', { class: 'formpage' },
      errorState({ title: '内建广场暂时无法加载', error, onRetry: () => location.reload() })));
  };

  const show = async (branch) => {
    const token = ++generation;
    const module = await (branch === 'birthday' ? loadBirthday() : loadLegacy());
    const view = await module.default(context, shell);
    const anchor = mounted ? mounted.view.node : host;
    if (disposed || token !== generation || !anchor.isConnected) { view.dispose?.(); return; }
    anchor.replaceWith(view.node);
    mounted?.view.dispose?.();
    mounted = { view, branch };
  };

  const assumed = lastKnownAvailability() === false ? 'legacy' : 'birthday';
  show(assumed).catch(failed);
  birthdayAvailable().then((enabled) => {
    const confirmed = enabled ? 'birthday' : 'legacy';
    if (confirmed !== assumed && !disposed) show(confirmed).catch(failed);
  }).catch(() => {});

  return {
    title: '内建广场',
    node: host,
    dispose() {
      disposed = true;
      generation += 1;
      mounted?.view.dispose?.();
    },
  };
}
