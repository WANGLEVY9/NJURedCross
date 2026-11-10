import { birthdayAvailable } from '../warmth-rollout.js';
import { h, icon } from '../../core/dom.js';
import { plazaHero } from '../plaza-hero.js';
import { COMMUNITY_SLIDES } from '../plaza-slides.js';
import { button, errorState } from '../../ui/primitives.js';
import { attachPageArt } from '../page-art.js';
import { buildUnoCard } from '../uno-card.js';

/** Keep the actual plaza composition visible while its capability is checked. */
function loadingPage() {
  const hero = plazaHero({
    label: 'NJU RED CROSS · 内建广场',
    ariaLabel: '内建广场精选',
    slides: COMMUNITY_SLIDES,
    copy: { title: '把温暖，留在彼此的日常', motto: '生日 · 问候 · 同伴', description: '生日里的一封信，日常里的一声问候。\n在这里，让善意有来有往。' },
    actions: [button({ label: '我的温暖连接', href: '/me?view=warmth', variant: 'primary', iconName: 'inbox' })],
  });
  const cards = [
    { id: 'birthday', name: '生日祝福', icon: 'sparkle', top: '一封祝福 · 一份惦念', copy: '把心意写进信里，\n为同学的生日添一份温暖。', description: '自愿加入，写下祝福。经审核后，由平台转达这份心意。' },
    { id: 'morning', name: '早安晚安', icon: 'handshake', top: '一声问候 · 一路同行', copy: '从一句早安开始，\n找到校园里与你同频的人。', description: '介绍自己，分享兴趣。名片审核通过后，可以认识同学并发起好友邀约。' },
  ];
  const programs = h('div', { class: 'community-programs community-programs--loading' }, ...cards.map(card =>
    h('article', { class: `community-program community-program--${card.id}`, attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'community-program__top' }, h('span', { text: card.top }), icon(card.icon, 'ico')),
      h('div', { class: `community-art community-art--${card.id}` }, h('span', { class: 'community-art__paper' }), h('span', { class: 'community-art__seal' })),
      h('div', { class: 'community-program__copy' }, h('h2', { text: card.name }), h('p', { text: card.copy }), h('p', { class: 'community-program__description', text: card.description })),
      h('div', { class: 'community-program__participation' }, h('span', { class: 'community-loading-line community-loading-line--status' }),
        h('div', { class: 'community-program__actions' }, ...(card.id === 'morning' ? [h('span', { class: 'community-loading-line community-loading-line--button' })] : []), h('span', { class: 'community-loading-line community-loading-line--button' }))),
      h('div', { class: 'community-program__privacy' }, h('span', { class: 'community-loading-line community-loading-line--privacy' })))),
    // The game entry is independent of capability discovery: show it with the
    // first paint and reuse the same node when the real page replaces the
    // skeleton, so it never flashes in a moment later.
    buildUnoCard());
  const node = h('div', { class: 'view plaza-page community-view' },
    h('div', { class: 'plaza-frame' }, hero.node),
    h('div', { class: 'community-page' }, programs, h('span', { class: 'sr-only', role: 'status', text: '正在加载参与计划' })));
  attachPageArt(node);
  return { node, dispose: hero.dispose };
}

/** Preserve the legacy flow when the birthday capability is unavailable. */
export default function page(...args) {
  let disposed = false, child, sequence = 0;
  const loading = loadingPage();
  const region = h('div', { class: 'region', 'aria-busy': 'true' }, loading.node);
  async function load() {
    const current = ++sequence;
    region.setAttribute('aria-busy', 'true');
    region.querySelector('.region__refresh-error')?.remove();
    try {
      const enabled = await birthdayAvailable();
      const module = await import(enabled ? './warmth-birthday.js' : './warmth-legacy.js');
      const result = await module.default(...args);
      if (disposed || current !== sequence) { result.dispose?.(); return; }
      child = result;
      attachPageArt(result.node);
      loading.dispose();
      region.replaceChildren(result.node);
    } catch (error) {
      if (disposed || current !== sequence) return;
      region.append(h('div', { class: 'region__refresh-error' }, errorState({ title: '参与计划暂时无法加载', error, onRetry: load })));
    } finally {
      if (!disposed && current === sequence) region.removeAttribute('aria-busy');
    }
  }
  void load();
  return { title: '内建广场', node: region, dispose: () => { disposed = true; sequence++; loading.dispose(); child?.dispose?.(); } };
}
