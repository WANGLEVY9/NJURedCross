import { h, icon } from '../core/dom.js';
import { activityEmblem } from './activity-emblem.js';
import { ACTIVITY_CATEGORY_OPTIONS } from '../shared/activity-taxonomy.js';

// Replace image URLs here when the owner supplies the carousel photographs.
// An empty image deliberately renders a neutral placeholder, never a stock photo.
export const EVENT_SLIDES = [
  { title: '把善意，化作行动', motto: '人道 · 博爱 · 奉献', description: '从校园出发，\n让每一份热情都有回响。', image: '', alt: '' },
  { title: '让关怀，成为日常', motto: '一起参与 · 一起改变', description: '从一次参与开始，\n与志同道合的伙伴同行。', image: '', alt: '' },
  { title: '用热爱，连接彼此', motto: '汇聚微光 · 传递温暖', description: '发现适合自己的活动，\n留下属于你的志愿故事。', image: '', alt: '' },
];

export function eventsHero({ slides = EVENT_SLIDES } = {}) {
  let current = 0, paused = false, hovered = false, timer;
  const title = h('h1');
  const motto = h('p', { class: 'events-hero__motto' });
  const description = h('p', { class: 'events-hero__description' });
  const art = h('div', { class: 'events-hero__art' });
  const dots = h('div', { class: 'events-hero__dots', aria: { label: '选择轮播页' } });
  const pause = h('button', { type: 'button', class: 'events-hero__pause', text: '暂停轮播', on: { click: () => { paused = !paused; pause.textContent = paused ? '播放轮播' : '暂停轮播'; schedule(); } } });
  const announce = h('span', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
  function show(index, manual = false) {
    current = (index + slides.length) % slides.length;
    const slide = slides[current];
    title.textContent = slide.title; motto.textContent = slide.motto; description.textContent = slide.description;
    art.replaceChildren(slide.image
      ? h('img', { src: slide.image, alt: slide.alt, width: 1000, height: 600 })
      : h('div', { class: 'events-hero__placeholder' }, h('img', { src: '/assets/nju-red-cross-emblem.jpg', alt: '', width: 80, height: 80 }), h('span', { text: '校园里的每一份善意' }), h('small', { text: '活动影像 · 待补充' })));
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
    if (manual) { announce.textContent = `第 ${current + 1} 张，共 ${slides.length} 张：${slide.title}`; schedule(); }
  }
  function schedule() {
    clearInterval(timer);
    if (!paused && !hovered && !node.contains(document.activeElement) && !matchMedia('(prefers-reduced-motion: reduce)').matches && slides.length > 1) timer = setInterval(() => show(current + 1), 6500);
  }
  dots.append(...slides.map((_, i) => h('button', { type: 'button', aria: { label: `切换到第 ${i + 1} 张` }, on: { click: () => show(i, true) } })));
  const node = h('section', { class: 'events-hero', aria: { label: '活动广场精选', roledescription: '轮播' }, on: {
    mouseenter: () => { hovered = true;clearInterval(timer); }, mouseleave: () => { hovered = false;schedule(); },
    focusin: () => clearInterval(timer), focusout: event => { if (!node.contains(event.relatedTarget)) schedule(); },
    keydown: event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); show(current + (event.key === 'ArrowLeft' ? -1 : 1), true); clearInterval(timer); } },
  } }, art,
  h('div', { class: 'events-hero__copy' }, h('p', { class: 'events-hero__eyebrow', text: 'NJU RED CROSS · 活动广场' }), title, motto, description,
    h('a', { class: 'btn btn--primary', href: '/me' }, icon('user', 'ico'), h('span', { text: '我的报名' }))),
  h('button', { type: 'button', class: 'events-hero__arrow events-hero__arrow--prev', aria: { label: '上一张' }, on: { click: () => show(current - 1, true) } }, icon('chevronLeft', 'ico')),
  h('button', { type: 'button', class: 'events-hero__arrow events-hero__arrow--next', aria: { label: '下一张' }, on: { click: () => show(current + 1, true) } }, icon('chevronRight', 'ico')),
  h('div', { class: 'events-hero__controls' }, pause, dots), announce);
  show(0); schedule();
  return { node, dispose: () => clearInterval(timer) };
}

export function eventsCategories(onSelect) {
  const descriptions = ['凝聚骨干力量', '传递人道关怀', '守护生命健康', '共建有序校园', '平等融合 温暖同行', '汇聚热血力量'];
  const node = h('nav', { class: 'events-categories', aria: { label: '活动类别快捷筛选' } },
    ...ACTIVITY_CATEGORY_OPTIONS.map((category, index) => h('button', { class: 'events-category', type: 'button', aria: { pressed: 'false' }, data: { category }, on: { click: () => onSelect(category) } },
      activityEmblem(category), h('strong', { text: category }), h('span', { text: descriptions[index] }))));
  return { node, setValue: value => [...node.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === value))) };
}

export function eventsGuide() {
  return h('aside', { class: 'events-guide', aria: { label: '参与流程' } }, h('h2', { text: '参与流程' }),
    h('ol', {}, ...[['选择活动', '浏览感兴趣的活动'], ['提交报名', '填写并提交报名信息'], ['查看结果', '留意报名状态与通知'], ['到场参与', '按时参加活动']].map(([title, detail], i) =>
      h('li', {}, h('b', { text: String(i + 1) }), h('div', {}, h('strong', { text: title }), h('span', { text: detail }))))));
}
