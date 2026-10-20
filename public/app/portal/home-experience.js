import { h } from '../core/dom.js';
import { publicApi } from '../core/api.js';
import { activityPresentation } from './activity-presentation.js';
import { HOME_CONTENT } from './home-content.js';
import { homeCarousel, photo, articleLink } from './home-carousel.js';
import { homeCranes } from './home-cranes.js';

const labels = ['正在开放报名的活动', '剩余名额', '累计报名人次', '可借用物资品类'];
function figure(value, label, { suffix = '' } = {}) {
  return h('div', { class: 'home-impact__item' }, h('b', { text: value != null && Number.isFinite(Number(value)) ? String(Number(value)) : '—' }), h('span', { text: suffix ? `${label} · ${suffix}` : label }));
}
function linked(item, child, className) {
  const link = articleLink(item.link);
  return link ? h('a', { class: className, href: link, target: '_blank', rel: 'noopener noreferrer' }, child) : h('div', { class: className }, child);
}
const storyDate = item => String(item.dateTime || item.date || '').replaceAll('.', '-');

export async function createHome() {
  let disposed = false;
  const carousel = homeCarousel();
  carousel.update(HOME_CONTENT.slides);
  const cranes = homeCranes();
  const impact = h('section', { class: 'home-impact', aria: { label: '参与概览', busy: 'true' } }, ...labels.map(label => figure(null, label)));
  const volunteers = h('div', { class: 'home-volunteers__photos' });
  const footprints = h('ol', { class: 'home-footprints__list', tabindex: '0', aria: { label: '红会足迹时间轴，可上下滚动查看更多' } });
  function renderStories(photos, stories) {
    volunteers.replaceChildren(...(photos.length ? photos.slice(0, 4) : [{}, {}]).map(item => linked(item,
      h('figure', null, photo(item), item.title ? h('figcaption', { text: item.title }) : null), 'home-volunteers__photo')));
    footprints.replaceChildren(...(stories.length ? [...stories].sort((a, b) => storyDate(b).localeCompare(storyDate(a))).map(item => h('li', null,
      linked(item, h('div', null, item.date ? h('time', { datetime: item.dateTime || item.date.replaceAll('.', '-') }, h('span', { text: item.date }), item.dateLabel ? h('small', { text: item.dateLabel }) : null) : null,
        h('h3', { text: item.title }), item.detail ? h('p', { text: item.detail }) : null), 'home-footprints__story'))) : [h('li', { class: 'home-footprints__empty', text: '新的红会足迹，正在记录。' })]));
  }
  renderStories(HOME_CONTENT.volunteers, HOME_CONTENT.footprints);
  const node = h('div', { class: 'view home-page home-redesign' }, carousel.node, impact, cranes.node,
    h('div', { class: 'home-stories' },
      h('section', { class: 'home-volunteers', aria: { labelledby: 'home-volunteers-title' } }, h('h2', { id: 'home-volunteers-title', text: '志愿者风采' }), volunteers),
      h('section', { class: 'home-footprints', aria: { labelledby: 'home-footprints-title' } }, h('h2', { id: 'home-footprints-title', text: '红会足迹' }), footprints)));
  // Each source updates its own region without waiting for the other source.
  let activityCount = null;
  let overviewStats = null;
  let catalogDone = false, overviewDone = false;
  let catalogFailed = false, overviewFailed = false;

  function renderFigures() {
    if (disposed) return;
    impact.replaceChildren(
      figure(activityCount, labels[0], { suffix: catalogFailed ? '暂未更新' : '' }),
      figure(overviewStats?.openSeats, labels[1], { suffix: overviewFailed ? '暂未更新' : '' }),
      figure(overviewStats?.totalRegistrations, labels[2], { suffix: overviewFailed ? '暂未更新' : '' }),
      figure(overviewStats?.inventoryCategories, labels[3], { suffix: overviewFailed ? '暂未更新' : '' }),
    );
    impact.setAttribute('aria-busy', String(!catalogDone || !overviewDone));
  }

  void publicApi.events().then(catalog => {
    if (disposed) return;
    const { blood, ordinary } = activityPresentation(catalog.events.filter(event => event.status === '报名中'));
    activityCount = ordinary.length + (blood.length ? 1 : 0);
  }).catch(() => {
    if (disposed) return;
    catalogFailed = true;
  }).finally(() => {
    catalogDone = true;
    renderFigures();
  });

  void publicApi.overview().then(payload => {
    if (disposed) return;
    if (!payload?.stats) throw new Error('参与概览响应缺少统计数据');
    overviewStats = payload.stats;
  }).catch(() => {
    if (disposed) return;
    overviewFailed = true;
  }).finally(() => {
    overviewDone = true;
    renderFigures();
  });

  // Public stories load separately from the participation statistics.
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
