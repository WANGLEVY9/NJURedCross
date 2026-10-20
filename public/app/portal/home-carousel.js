import { h, setVars } from '../core/dom.js';
import { managedImage, mediaFor, imageReady, heroSizes, photoSizes, mayPrefetch } from './image-source.js';

export function articleLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function photo(item, className = '', { priority = false } = {}) {
  const frame = h('div', { class: `home-photo ${className}` });
  const placeholder = () => {
    frame.dataset.imageState = 'failed';
    frame.replaceChildren(h('span', { class: 'home-photo__empty', text: '活动影像待更新' }));
  };
  if (!item?.image) placeholder();
  const crop = item?.crop;
  const applyCrop = () => {
    if (crop && [crop.x, crop.y, crop.width, crop.height, crop.sourceWidth].every(Number.isFinite) && crop.width > 0 && crop.height > 0) {
      frame.classList.add('home-photo--crop');
      setVars(frame, { '--photo-ratio': String(crop.width / crop.height), '--photo-width': `${crop.sourceWidth / crop.width * 100}%`, '--photo-left': `${-crop.x / crop.width * 100}%`, '--photo-top': `${-crop.y / crop.height * 100}%` });
    }
  };
  if (item?.image) frame.append(managedImage(item.image, { alt: item.title || '红会活动影像', priority, sizes: priority ? heroSizes : photoSizes, onFailure: placeholder, onFallback: applyCrop }));
  if (!mediaFor(item?.image)?.cropped) applyCrop();
  return frame;
}

export function homeCarousel() {
  let slides = [], current = 0, timer = null, stopped = false;
  let hovered = false, focused = false, disposed = false, request = 0;
  const frames = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stage = h('div', { class: 'home-banner__stage' });
  const dots = h('div', { class: 'home-banner__dots', aria: { label: '选择轮播图片' } });
  const counter = h('span', { class: 'sr-only', aria: { live: 'off' } });
  const pause = h('button', { type: 'button', class: 'home-banner__pause', text: '暂停轮播', on: { click: () => { stopped = !stopped; pause.textContent = stopped ? '播放轮播' : '暂停轮播'; schedule(); } } });
  const control = (label, step) => h('button', { type: 'button', class: `home-banner__arrow home-banner__arrow--${step < 0 ? 'prev' : 'next'}`, aria: { label }, on: { click: () => show(current + step) } },
    h('svg', { viewBox: '0 0 24 24', aria: { hidden: 'true' } }, h('polyline', { points: step < 0 ? '15,6 9,12 15,18' : '9,6 15,12 9,18' })));
  const prev = control('上一张图片', -1), next = control('下一张图片', 1);
  const mayPlay = () => !disposed && slides.length > 1 && !stopped && !hovered && !focused && !document.hidden && !reduced.matches;
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (mayPlay()) timer = setTimeout(() => {
      timer = null;
      // Preferences can change before their queued change event is delivered.
      if (mayPlay()) show(current + 1);
    }, 6500);
  }
  function frameAt(index) {
    if (!frames.has(index)) {
      if (frames.size >= 3) frames.delete(frames.keys().next().value);
      frames.set(index, photo(slides[index], '', { priority: true }));
    }
    return frames.get(index);
  }
  function show(index) {
    if (!slides.length || disposed) return;
    current = (index + slides.length) % slides.length;
    const selected = current, ticket = ++request;
    const item = slides[selected], link = articleLink(item.link), image = frameAt(selected);
    const commit = () => {
      if (disposed || ticket !== request) return;
      stage.replaceChildren(link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', aria: { label: `${item.title}（在新窗口打开）` } }, image) : image);
      stage.removeAttribute('aria-busy');
      [...dots.children].forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === selected)));
      counter.textContent = `${selected + 1} / ${slides.length}`;
      void imageReady(image.querySelector('img')).then(() => {
        if (!disposed && ticket === request && mayPrefetch() && slides.length > 1) {
          const next = frameAt((selected + 1) % slides.length).querySelector('img');
          next?.setAttribute('fetchpriority', 'low');
        }
      }).catch(() => {});
      schedule();
    };
    if (!stage.childElementCount) commit();
    else {
      stage.setAttribute('aria-busy', 'true');
      const ready = image.dataset.imageState === 'failed' ? Promise.reject(new Error('Image unavailable')) : imageReady(image.querySelector('img'));
      void ready.then(commit).catch(() => {
        frames.delete(selected);
        if (ticket === request && !disposed) { stage.removeAttribute('aria-busy'); schedule(); }
      });
    }
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
    frames.clear();
    slides = items.filter(item => item.image).slice(0, 8);
    const multiple = slides.length > 1;
    for (const element of [prev, next, dots, pause]) element.hidden = !multiple;
    dots.replaceChildren(...slides.map((item, i) => h('button', { type: 'button', aria: { label: `第 ${i + 1} 张：${item.title}`, pressed: 'false' }, on: { click: () => show(i) } })));
    if (slides.length) show(0);
    else stage.replaceChildren(photo(null));
  }, dispose() { disposed = true; request++; frames.clear(); clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility); } };
}
