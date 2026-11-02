import { h, icon } from '../core/dom.js';
import { managedImage, imageReady } from './image-source.js';

/**
 * 广场通用主视觉轮播（活动 / 宣传 / 内建 / 物资共用一套结构与动效）。
 *
 * 四个广场只在文案与影像上不同：结构、键盘可达性、暂停与自动轮播、解码切换、
 * 失败提示都由这里统一，避免各广场各写一套后风格漂移。影像走托管媒体的
 * srcset，桌面约 960w、窄屏 480w，不直接下载原图。
 */
const HERO_SIZES = '(max-width: 640px) 100vw, (max-width: 1280px) 70vw, 960px';
// 工作区横幅只有 150px 高、宽度约六成页面：按更小的展示宽度声明，避免取过大变体。
const BANNER_SIZES = '(max-width: 640px) 100vw, (max-width: 1280px) 60vw, 960px';

export function plazaHero({
  label = '',
  ariaLabel = '',
  slides = [],
  copy = {},
  actions = [],
  intervalMs = 6500,
  variant = 'plaza',
} = {}) {
  // 'plaza' 是广场大图（带文案区）；'banner' 是管理端工作区的紧凑横幅（只有影像与控件）。
  const base = variant === 'banner' ? 'workspace-hero' : 'events-hero';
  const part = name => `${base}__${name}`;
  const items = slides.length ? slides : [{ alt: '' }];
  let current = 0, paused = false, hovered = false, timer;

  const art = h('div', { class: part('art') });
  const dots = h('div', { class: part('dots'), aria: { label: '选择轮播页' } });
  const pause = h('button', {
    type: 'button', class: part('pause'), text: '暂停轮播',
    on: { click: () => { paused = !paused; pause.textContent = paused ? '播放轮播' : '暂停轮播'; schedule(); } },
  });
  const announce = h('span', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
  const placeholder = () => h('div', { class: part('placeholder') },
    h('img', { src: '/assets/nju-red-cross-emblem-128.webp', alt: '', width: 96, height: 96 }),
    h('span', { class: part('placeholder-title'), text: copy.placeholderTitle || '校园里的每一份善意' }),
    h('small', { text: '活动影像 · 客照待传' }));
  const missing = h('p', { class: part('missing'), role: 'status', text: '这张影像暂未加载' });

  function buildSlide(slide) {
    const image = managedImage(slide.image, {
      alt: slide.alt, priority: true, decoding: 'async', sizes: variant === 'banner' ? BANNER_SIZES : HERO_SIZES,
      vars: { 'hero-position': slide.position || 'center' },
    });
    if (!image.width) { image.width = 1920; image.height = 1280; }
    return image;
  }
  function commit(node) {
    missing.remove();
    art.replaceChildren(node);
    art.removeAttribute('aria-busy');
  }
  function show(index, manual = false) {
    current = (index + items.length) % items.length;
    const slide = items[current];
    if (!slide.image) commit(placeholder());
    else if (!art.childElementCount) commit(buildSlide(slide));
    else {
      // 下一张解码完成前保留当前影像，避免切换时闪出空白。
      const next = buildSlide(slide);
      art.setAttribute('aria-busy', 'true');
      imageReady(next).then(() => { if (node.isConnected) commit(next); })
        .catch(() => {
          if (!node.isConnected) return;
          // 加载失败：保留当前影像，只给出可感知的提示。
          art.removeAttribute('aria-busy');
          art.append(missing);
        });
    }
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
    if (manual) {
      announce.textContent = `第 ${current + 1} 张，共 ${items.length} 张${slide.alt ? `：${slide.alt}` : ''}`;
      schedule();
    }
  }
  function schedule() {
    clearInterval(timer);
    if (!paused && !hovered && !node.contains(document.activeElement)
      && !matchMedia('(prefers-reduced-motion: reduce)').matches && items.length > 1) {
      timer = setInterval(() => show(current + 1), intervalMs);
    }
  }

  dots.append(...items.map((_, i) => h('button', {
    type: 'button', aria: { label: `切换到第 ${i + 1} 张` }, on: { click: () => show(i, true) },
  })));

  const copyChildren = [
    label ? h('p', { class: part('eyebrow'), text: label }) : null,
    h('h1', { text: copy.title || '' }),
    copy.motto ? h('p', { class: part('motto'), text: copy.motto }) : null,
    copy.description ? h('p', { class: part('description'), text: copy.description }) : null,
    actions.length ? h('div', { class: 'events-hero__actions' }, ...actions) : null,
  ].filter(Boolean);

  const node = h('section', {
    class: variant === 'banner' ? base : `${base} plaza-hero`,
    aria: { label: ariaLabel || (label ? `${label}精选` : '工作区影像'), roledescription: '轮播' },
    data: { plazaHero: '' },
    on: {
      mouseenter: () => { hovered = true; clearInterval(timer); },
      mouseleave: () => { hovered = false; schedule(); },
      focusin: () => clearInterval(timer),
      focusout: event => { if (!node.contains(event.relatedTarget)) schedule(); },
      keydown: event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        show(current + (event.key === 'ArrowLeft' ? -1 : 1), true);
        clearInterval(timer);
      },
    },
  }, art,
  // 横幅模式不渲染文案区：工作区标题已经由页面自己给出。
  variant === 'banner' ? null : h('div', { class: part('copy') }, ...copyChildren),
  h('button', { type: 'button', class: `${part('arrow')} ${part('arrow')}--prev`, aria: { label: '上一张' }, on: { click: () => show(current - 1, true) } }, icon('chevronLeft', 'ico')),
  h('button', { type: 'button', class: `${part('arrow')} ${part('arrow')}--next`, aria: { label: '下一张' }, on: { click: () => show(current + 1, true) } }, icon('chevronRight', 'ico')),
  h('div', { class: part('controls') }, pause, dots), announce);

  show(0);
  schedule();
  return { node, dispose: () => clearInterval(timer) };
}
