import { h } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { errorState } from '../../ui/primitives.js';

/* --------------------------------------------------------------------------
   Capability answer

   The answer only changes on a deploy or a pilot toggle, and the server caches
   the underlying schema check for 30 seconds. Remembering it for the same
   window keeps route switches inside the board from paying another round trip,
   and concurrent callers share one request. Failures are never remembered.

   It lives here, next to the plaza, because this module must start its page
   module on the first response: every extra import would add a round trip
   before the plaza can render anything. 会员中心 and the console import the
   same answer from this file.
   -------------------------------------------------------------------------- */
const ANSWER_TTL_MS = 30_000;
let answer = null;
let pending = null;

/** Last answer inside the TTL, or null when the page has to ask again. */
export function lastKnownAvailability() {
  return answer && Date.now() < answer.expiresAt ? answer.value : null;
}

/**
 * Resolves to `true`/`false` when the deployment answered, and to `null` when
 * the check could not be made at all (offline blip, 5xx, aborted request).
 * Callers must treat `null` as "keep the view that is already on screen":
 * reading a transport failure as "the pilot is off" would downgrade a working
 * plaza for the rest of the visit. Failures are not remembered.
 *
 * Old deployments and incomplete production schemas retain main's existing UI.
 */
export async function birthdayAvailable() {
  const remembered = lastKnownAvailability();
  if (remembered !== null) return remembered;
  if (!pending) {
    pending = request('/api/public/warmth/capabilities')
      .then((result) => {
        const value = result.birthday?.enabled === true && result.birthday?.ready === true;
        answer = { value, expiresAt: Date.now() + ANSWER_TTL_MS };
        return value;
      })
      .catch(() => null)
      .finally(() => { pending = null; });
  }
  return pending;
}

/* --------------------------------------------------------------------------
   Preview

   内建广场 owns its own wait: the page renders this frame immediately and
   swaps in the real view once the module graph lands, so the plaza never shows
   a blank screen or the previous page without a sign that something is
   loading. Styles live in warmth.css and only serve this page; the reveal is
   delayed so a fast load never flashes it.
   -------------------------------------------------------------------------- */
export function warmthPreview() {
  return h(
    'div',
    { class: 'warmth-preview' },
    h(
      'div',
      { class: 'warmth-preview__frame', aria: { hidden: 'true' } },
      h('span', { class: 'warmth-preview__eyebrow' }),
      h('span', { class: 'warmth-preview__line' }),
      h('span', { class: 'warmth-preview__line warmth-preview__line--short' }),
      h('span', { class: 'warmth-preview__line warmth-preview__line--text' }),
      h(
        'div',
        { class: 'warmth-preview__cards' },
        h('span', { class: 'warmth-preview__card' }),
        h('span', { class: 'warmth-preview__card' }),
        h('span', { class: 'warmth-preview__card' }),
      ),
    ),
    h('p', { class: 'sr-only', attrs: { role: 'status' }, text: '正在载入内建广场，请稍候' }),
  );
}

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
  birthdayAvailable().then((answered) => {
    if (answered === null) return;              // 没能问到：保留已经渲染的视图
    const confirmed = answered ? 'birthday' : 'legacy';
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
