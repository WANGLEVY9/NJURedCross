import { h } from '../core/dom.js';
import { publicApi } from '../core/api.js';
import { activityPresentation } from './activity-presentation.js';
import { HOME_CONTENT } from './home-content.js';
import { homeCarousel, photo, articleLink } from './home-carousel.js';
import { homeCranes } from './home-cranes.js';

const labels = ['正在开放报名的活动', '剩余名额', '累计报名人次', '可借用物资品类'];
function figure(value, label) {
  return h('div', { class: 'home-impact__item' }, h('b', { text: value != null && Number.isFinite(Number(value)) ? String(Number(value)) : '—' }), h('span', { text: label }));
}
function linked(item, child, className) {
  const link = articleLink(item.link);
  return link ? h('a', { class: className, href: link, target: '_blank', rel: 'noopener noreferrer' }, child) : h('div', { class: className }, child);
}

export async function createHome() {
  let disposed = false;
  const carousel = homeCarousel();
  carousel.update(HOME_CONTENT.slides);
  const cranes = homeCranes();
  const impact = h('section', { class: 'home-impact', aria: { label: '参与概览', busy: 'true' } }, ...labels.map(label => figure(null, label)));
  const volunteers = h('div', { class: 'home-volunteers__photos' });
  const footprints = h('ol', { class: 'home-footprints__list' });
  function renderStories(photos, stories) {
    volunteers.replaceChildren(...(photos.length ? photos.slice(0, 2) : [{}, {}]).map(item => linked(item,
      h('figure', null, photo(item), item.title ? h('figcaption', { text: item.title }) : null), 'home-volunteers__photo')));
    footprints.replaceChildren(...(stories.length ? stories.slice(0, 3).map(item => h('li', null,
      linked(item, h('div', null, item.date ? h('time', { text: item.date }) : null,
        h('h3', { text: item.title }), item.detail ? h('p', { text: item.detail }) : null), 'home-footprints__story'))) : [h('li', { class: 'home-footprints__empty', text: '新的红会足迹，正在记录。' })]));
  }
  renderStories(HOME_CONTENT.volunteers, HOME_CONTENT.footprints);
  const node = h('div', { class: 'view home-page home-redesign' }, carousel.node, impact, cranes.node,
    h('div', { class: 'home-stories' },
      h('section', { class: 'home-volunteers', aria: { labelledby: 'home-volunteers-title' } }, h('h2', { id: 'home-volunteers-title', text: '志愿者风采' }), volunteers),
      h('section', { class: 'home-footprints', aria: { labelledby: 'home-footprints-title' } }, h('h2', { id: 'home-footprints-title', text: '红会足迹' }), footprints)));
  Promise.all([publicApi.events(), publicApi.overview()]).then(([catalog, payload]) => {
    if (disposed) return;
    const { blood, ordinary } = activityPresentation(catalog.events.filter(event => event.status === '报名中'));
    const stats = payload.stats;
    impact.replaceChildren(...[ordinary.length + (blood.length ? 1 : 0), stats.openSeats, stats.totalRegistrations, stats.inventoryCategories].map((value, i) => figure(value, labels[i])));
    impact.setAttribute('aria-busy', 'false');
  }).catch(() => {
    if (disposed) return;
    impact.setAttribute('aria-busy', 'false');
    impact.append(h('p', { class: 'home-impact__error', role: 'status', text: '参与概览暂未更新，请稍后再试。' }));
  });
  publicApi.showcaseFeed().then(payload => {
    if (disposed) return;
    const groups = payload.boards?.posts?.groups || payload.groups || [];
    const items = groups.flatMap(group => (group.items || []).map(item => ({ ...item, group: group.name })));
    if (!HOME_CONTENT.slides.length) carousel.update(items.filter(item => item.coverUrl).map(item => ({ ...item, image: item.coverUrl })));
    const photos = HOME_CONTENT.volunteers.length ? HOME_CONTENT.volunteers : items.filter(item => item.group === '志愿者风采' && item.coverUrl).map(item => ({ ...item, image: item.coverUrl }));
    const stories = HOME_CONTENT.footprints.length ? HOME_CONTENT.footprints : items.filter(item => ['活动总结', '红会足迹'].includes(item.group));
    renderStories(photos, stories);
  }).catch(() => { /* The independently configured homepage stays usable without the showcase service. */ });
  return { title: '首页', node, dispose() { disposed = true; carousel.dispose(); cranes.dispose(); } };
}
