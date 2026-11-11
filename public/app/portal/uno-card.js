/* ==========================================================================
   南小红UNO 入口卡片 —— 在「内建广场」固定展示。
   与生日祝福 / 早安晚安 的灰度变体无关，由 warmth.js 调度层统一注入，
   保证无论走 warmth-birthday 还是 warmth-legacy 都能看到这张入口卡片。

   这张卡是同步首屏内容：不依赖 capabilities 接口，且在业务卡刷新时复用
   同一个 DOM 节点，避免「先两张、后突然冒出第三张」的闪烁与动画重播。
   ========================================================================== */
import { h, icon } from '../core/dom.js';
import { assetUrl } from '../core/asset-url.js';
import { button } from '../ui/primitives.js';

/** 入口卡装饰样式自包含按需加载：只在 buildUnoCard 被调用时插入一次。 */
function ensureUnoEntryStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-uno-entry-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = assetUrl('/styles/uno-entry.css');
  link.dataset.unoEntryStyle = '1';
  document.head.append(link);
}

const UNO_MODULES = [
  '/app/portal/pages/uno.js',
  '/app/games/uno/engine.js',
  '/app/games/uno/ai.js',
  '/app/games/uno/client.js',
  // v13 added these three static dependencies; without them an early click
  // still pays for a second module waterfall after the preloaded ones.
  '/app/games/uno/bgm.js',
  '/app/games/uno/announce.js',
  '/app/games/uno/hand-sort.js',
  '/app/games/uno/motion.js',
  '/styles/uno.css',
];
let prefetched = false;
let cachedCard = null;

/** 进广场时预热牌桌模块，避免点击入口后才开始逐层解析 import。 */
function prefetchUno() {
  if (prefetched || typeof document === 'undefined') return;
  prefetched = true;
  for (const href of UNO_MODULES) {
    const link = document.createElement('link');
    link.rel = href.endsWith('.css') ? 'preload' : 'modulepreload';
    if (href.endsWith('.css')) link.as = 'style';
    link.href = assetUrl(href);
    document.head.append(link);
  }
}

function watchUnoIntent(card) {
  if (typeof window === 'undefined' || typeof card?.addEventListener !== 'function') return;
  for (const event of ['pointerenter', 'focusin', 'touchstart']) {
    card.addEventListener(event, prefetchUno, { once: true, passive: true });
  }
  // Warm the game as soon as the plaza goes idle instead of waiting a fixed
  // three seconds: visitors who click immediately must not hit a cold import
  // graph. requestIdleCallback keeps the downloads off the first paint path.
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(prefetchUno, { timeout: 1200 });
  else window.setTimeout(prefetchUno, 0);
}

export function buildUnoCard() {
  ensureUnoEntryStyles();
  if (cachedCard) return cachedCard;
  const card = h('article', { class: 'community-program community-program--uno', id: 'uno-entry' },
    h('div', { class: 'community-program__top' }, h('span', { text: '一副手绘 · 一场小聚' }), icon('sparkle', 'ico')),
    h('div', { class: 'community-art community-art--uno', attrs: { 'aria-hidden': 'true' } },
      h('span', { class: 'community-art__paper' }), h('span', { class: 'community-art__seal' })),
    h('div', { class: 'community-program__copy' },
      h('h2', { text: '南小红UNO' }),
      h('p', { text: '休息时来一局。\n支持人机练习与联机房间，+2/+4 可叠加、+4 还能质疑。' }),
      h('p', { class: 'community-program__description', text: '原创牌面，非官方、非商业的内部娱乐功能；联机房间数据仅在内存，服务器重启即清空。' })),
    h('div', { class: 'community-program__participation' },
      h('span', { class: 'community-program__status', text: '无需登录即可游玩' }),
      h('div', { class: 'community-program__actions' },
        button({ label: '去玩一局', href: '/games/uno', variant: 'primary', iconAfter: 'arrowRight' }))),
    h('details', { class: 'community-program__privacy' },
      h('summary', { text: '玩法说明' }),
      h('p', { text: '标准 108 张牌；变色与加四随时可出，+2/+4 被罚时可继续叠加，+4 仅当手里没有当前色牌才能出且可被下家质疑。' }),
      h('ul', null, ...['非官方、非商业的内部娱乐', '联机由服务端判定，看不到他人手牌', '房间数据仅在内存，重启清空'].map((item) => h('li', { text: item })))));
  watchUnoIntent(card);
  cachedCard = card;
  return card;
}
