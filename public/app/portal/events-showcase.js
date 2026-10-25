import { h, icon } from '../core/dom.js';
import { activityEmblem } from './activity-emblem.js';
import { ACTIVITY_CATEGORY_OPTIONS } from '../shared/activity-taxonomy.js';

const HERO_COPY = { title: '把善意，化作行动', motto: '人道 · 博爱 · 奉献', description: '从校园出发，\n让每一份热情都有回应。' };
export const EVENT_SLIDES = [
  { image: '/assets/events-carousel/activity-01.webp', alt: '南京大学红十字会青春风采展志愿者合影', position: '50% 60%' },
  { image: '/assets/events-carousel/activity-02.webp', alt: '红十字会成员手持会旗与项目奖牌合影', position: '50% 58%' },
  { image: '/assets/events-carousel/activity-03.webp', alt: '红十字志愿者在教室内手持会旗合影', position: '50% 60%' },
  { image: '/assets/events-carousel/activity-04.webp', alt: '生命的信任宣讲会南京大学篇现场合影', position: '50% 70%' },
  { image: '/assets/events-carousel/activity-05.webp', alt: '南京大学博爱青春服务队活动合影', position: '50% 68%' },
  { image: '/assets/events-carousel/activity-06.webp', alt: '红十字青年交流活动现场合影', position: '50% 65%' },
];

export function eventsHero({ slides = EVENT_SLIDES } = {}) {
  let current = 0, paused = false, hovered = false, timer;
  const title = h('h1', { text: HERO_COPY.title });
  const motto = h('p', { class: 'events-hero__motto', text: HERO_COPY.motto });
  const description = h('p', { class: 'events-hero__description', text: HERO_COPY.description });
  const art = h('div', { class: 'events-hero__art' });
  const dots = h('div', { class: 'events-hero__dots', aria: { label: '选择轮播页' } });
  const pause = h('button', { type: 'button', class: 'events-hero__pause', text: '暂停轮播', on: { click: () => { paused = !paused; pause.textContent = paused ? '播放轮播' : '暂停轮播'; schedule(); } } });
  const announce = h('span', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
  function show(index, manual = false) {
    current = (index + slides.length) % slides.length;
    const slide = slides[current];
    art.replaceChildren(slide.image
      ? h('img', { src: slide.image, alt: slide.alt, width: 1920, height: 1280, decoding: 'async', vars: { 'hero-position': slide.position || 'center' } })
      : h('div', { class: 'events-hero__placeholder' }, h('img', { src: '/assets/nju-red-cross-emblem.jpg', alt: '', width: 96, height: 96 }), h('span', { class: 'events-hero__placeholder-title', text: '校园里的每一份善意' }), h('small', { text: '活动影像 · 客照待传' })));
    [...dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
    if (manual) { announce.textContent = `第 ${current + 1} 张，共 ${slides.length} 张${slide.alt ? `：${slide.alt}` : ''}`; schedule(); }
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
  const descriptions = {
    '主席团专项':'凝聚骨干力量', '博爱中心':'传递人道关怀', '生命中心':'守护生命健康',
    '综事中心':'共建有序校园', '一加助残专项':'携手温暖同行',
    '献血车专项':'汇聚热血力量', '排班类':'协力值守校园',
  };
  const categories = [...ACTIVITY_CATEGORY_OPTIONS.filter(category => category !== '排班类'), '排班类'];
  const node = h('nav', { class: 'events-categories', aria: { label: '活动类别快捷筛选' } },
    ...categories.map(category => h('button', { class: 'events-category', type: 'button', aria: { pressed: 'false' }, data: { category }, on: { click: () => onSelect(category) } },
      activityEmblem(category), h('strong', { text: category }), h('span', { text: descriptions[category], title: descriptions[category] }))));
  return { node, setValue: value => [...node.children].forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === value))) };
}

export function eventsGuide() {
  return h('aside', { class: 'events-guide', aria: { label: '参与流程' } }, h('h2', { text: '参与流程' }),
    h('ol', {}, ...[['选择活动', '浏览感兴趣的活动'], ['提交报名', '填写并提交报名信息'], ['等待确认', '查看审核结果'], ['到场参与', '按时参加活动']].map(([title, detail], i) =>
      h('li', {}, h('b', { text: String(i + 1) }), h('div', {}, h('strong', { text: title }), h('span', { text: detail }))))));
}
