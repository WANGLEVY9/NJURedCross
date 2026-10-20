import { h, setVars } from '../core/dom.js';

export function articleLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function photo(item, className = '') {
  const frame = h('div', { class: `home-photo ${className}` });
  const placeholder = () => frame.replaceChildren(h('span', { class: 'home-photo__empty', text: '活动影像待更新' }));
  if (!item?.image) placeholder();
  else frame.append(h('img', { src: item.image, alt: item.title || '红会活动影像', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: placeholder } }));
  const crop = item?.crop;
  if (crop && [crop.x, crop.y, crop.width, crop.height, crop.sourceWidth].every(Number.isFinite) && crop.width > 0 && crop.height > 0) {
    frame.classList.add('home-photo--crop');
    setVars(frame, { '--photo-ratio': String(crop.width / crop.height), '--photo-width': `${crop.sourceWidth / crop.width * 100}%`, '--photo-left': `${-crop.x / crop.width * 100}%`, '--photo-top': `${-crop.y / crop.height * 100}%` });
  }
  return frame;
}

export function homeCarousel() {
  let slides = [], current = 0, timer = null, stopped = false;
  let hovered = false, focused = false, disposed = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stage = h('div', { class: 'home-banner__stage' });
  const dots = h('div', { class: 'home-banner__dots', aria: { label: '选择轮播图片' } });
  const counter = h('span', { class: 'sr-only', aria: { live: 'off' } });
  const pause = h('button', { type: 'button', class: 'home-banner__pause', text: '暂停轮播', on: { click: () => { stopped = !stopped; pause.textContent = stopped ? '播放轮播' : '暂停轮播'; schedule(); } } });
  const control = (label, step) => h('button', { type: 'button', class: `home-banner__arrow home-banner__arrow--${step < 0 ? 'prev' : 'next'}`, aria: { label }, text: step < 0 ? '‹' : '›', on: { click: () => show(current + step) } });
  const prev = control('上一张图片', -1), next = control('下一张图片', 1);
  function schedule() {
    clearTimeout(timer);
    if (!disposed && slides.length > 1 && !stopped && !hovered && !focused && !document.hidden && !reduced.matches) timer = setTimeout(() => show(current + 1), 6500);
  }
  function show(index) {
    if (!slides.length || disposed) return;
    current = (index + slides.length) % slides.length;
    const item = slides[current], link = articleLink(item.link);
    const image = photo(item);
    image.querySelector('img')?.setAttribute('loading', 'eager');
    stage.replaceChildren(link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', aria: { label: `${item.title}（在新窗口打开）` } }, image) : image);
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === current)));
    counter.textContent = `${current + 1} / ${slides.length}`;
    schedule();
  }
  const node = h('section', { class: 'home-banner', aria: { label: '红会活动影像轮播', roledescription: '轮播图' }, on: {
    mouseenter: () => { hovered = true; schedule(); }, mouseleave: () => { hovered = false; schedule(); },
    focusin: () => { focused = true; schedule(); }, focusout: event => { focused = node.contains(event.relatedTarget); schedule(); },
  } }, stage, prev, next, dots, pause, counter);
  const visibility = () => schedule();
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', visibility);
  return { node, update(items) {
    if (disposed) return;
    slides = items.filter(item => item.image).slice(0, 8);
    const multiple = slides.length > 1;
    for (const element of [prev, next, dots, pause]) element.hidden = !multiple;
    dots.replaceChildren(...slides.map((item, i) => h('button', { type: 'button', aria: { label: `第 ${i + 1} 张：${item.title}`, pressed: 'false' }, on: { click: () => show(i) } })));
    if (slides.length) show(0);
    else stage.replaceChildren(photo(null));
  }, dispose() { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility); } };
}
