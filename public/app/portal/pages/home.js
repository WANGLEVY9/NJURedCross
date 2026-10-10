import { eventRow } from '../activity-row.js';
import { activityPresentation } from '../activity-presentation.js';
import { bloodEntry } from '../blood-entry.js';
import { PORTAL_NAV } from '../navigation.js';
/* ==========================================================================
   portal/pages/home.js
   Task: a visitor lands here to answer "what can I join, and how do I start?"
   Structure: intent-led hero → live openings → service programmes → trust.
   ========================================================================== */

import { h, icon, setVars } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { rememberOrigin } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, badge, statusIndicator, emptyState, errorState, skeletonBlock, barTrack } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';

function figure(value, label, { suffix = '' } = {}) {
  return h(
    'div',
    { class: 'hero__figure' },
    h('b', { text: String(Number(value)||0) }),
    h('span', { text: suffix ? `${label} · ${suffix}` : label }),
  );
}

export function eventCard(event, { compact = false } = {}) {
  const seatRatio = event.capacity ? fmt.ratio(event.confirmed, event.capacity) : 0;
  const until = fmt.daysUntil(event.registrationEnd);
  const node = h(
    'a',
    {
      class: 'event',
      href: `/events/${encodeURIComponent(event.eventId)}`,
      data: { flipKey: event.eventId },
      on: {
        click: (e) => {
          e.preventDefault();
          navigate(`/events/${encodeURIComponent(event.eventId)}`, { state: { origin: rememberOrigin(node) } });
        },
      },
    },
    h(
      'div',
      { class: 'event__meta' },
      badge(event.type || '公益活动', { tone: 'accent' }),
      event.status === '报名中'
        ? statusIndicator(event.full ? (event.workflowId ? '名额已满' : '名额已满 · 可候补') : '报名中', { tone: event.full ? 'warning' : 'success', live: true })
        : statusIndicator(event.status || '未标注', { tone: event.status === '进行中' ? 'info' : 'idle' }),
      until !== null && until >= 0 && event.status === '报名中'
        ? h('span', { class: 't-caption t-muted', text: until === 0 ? '今天截止报名' : `还有 ${until} 天截止` })
        : null,
    ),
    h(
      'div',
      { class: 'stack-2' },
      h('h3', { class: 'event__title t-clamp-2', text: event.name }),
      !compact && event.description ? h('p', { class: 't-secondary t-clamp-2', text: event.description }) : null,
    ),
    h(
      'div',
      { class: 'event__facts' },
      h('span', { class: 'event__fact' }, icon('clock', 'ico ico--sm'), h('span', { text: event.schedule || fmt.dateRange(event.startAt, event.endAt) })),
      h('span', { class: 'event__fact' }, icon('pin', 'ico ico--sm'), h('span', { class: 'truncate', text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
    ),
    h(
      'div',
      { class: 'event__foot' },
      h(
        'div',
        { class: 'event__capacity' },
        h(
          'div',
          { class: 'row-2 row-between' },
          h('span', { class: 't-caption t-muted', text: event.capacity ? `已确认 ${event.confirmed} / ${event.capacity}` : '容量不限' }),
          event.waitlisted ? h('span', { class: 't-caption t-muted', text: `候补 ${event.waitlisted}` }) : null,
        ),
        event.capacity
          ? barTrack([
              { label: '已确认', value: event.confirmed, color: event.full ? 'var(--warning)' : 'var(--accent)' },
              { label: '剩余', value: Math.max(0, event.capacity - event.confirmed), color: 'transparent' },
            ])
          : null,
      ),
      h('span', { class: 'event__go' }, icon('arrowRight', 'ico')),
    ),
  );
  if (event.capacity) setVars(node, { '--seat': seatRatio });
  return node;
}

export default async function homePage() {
  const figuresSlot = h('div', { class: 'hero__figures', attrs: { 'aria-busy': 'true' } },
    ...['正在开放报名的活动', '剩余名额', '累计报名人次', '可借用物资品类'].map(label =>
      h('div', { class: 'hero__figure' }, h('b', { text: '—' }), h('span', { text: label }))));
  const railSlot = h('div', { class: 'stack-4' }, skeletonBlock('180px'));
  const programsSlot = h('div', { class: 'square-grid square-grid--home' }, ...PORTAL_NAV.map(item =>
    h('a',{class:`square-card service-index__${item.path.slice(1)}`,href:item.path},h('span',{class:'square-card__icon'},icon(item.iconName,'ico ico--lg')),
      h('h3',{class:'t-h3',text:item.label}),h('p',{class:'t-secondary',text:item.description}),
      h('span',{class:'square-card__action'},h('span',{text:'进入'}),icon('arrowRight','ico ico--sm')))));

  const hero = h(
    'section',
    { class: 'hero discovery-hero' },
    h(
      'div',
      { class: 'hero__inner' },
      h(
        'div',
        { class: 'hero__lede' },
        h('p', { class: 'discovery-hero__motto', text: '人道 · 博爱 · 奉献' }),
        h('h1', null, h('span', { text: '让每一次参与' }), h('em', { text: '都有回应' })),
        h('p', {
          class: 'hero__sub',
          text: '参加急救培训与公益活动，借用活动物资，分享校园里的善意。在会员中心查看每一次参与的进度。',
        }),
        h(
          'div',
          { class: 'hero__cta' },
          button({ label: '浏览开放活动', variant: 'primary', size: 'lg', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' }),
          button({ label: '查看参与记录', variant: 'inverse', size: 'lg', iconName: 'user', href: '/me' }),
        ),
      ),
      h('figure', { class: 'hero-art' },
        h('div', { class: 'hero-art__caption' },
          h('span', { text: '南京大学红十字会' }),
          h('span', { text: '校园里的善意，彼此相连' })),
        h('img', { class: 'hero-art__image', src: '/assets/campus-connection.svg',
          alt: '两条朱红与暖橙色纽带交织相连，象征参与和回应', width: 640, height: 480,
          attrs: { fetchpriority: 'high', decoding: 'async' } }),
        h('figcaption', { class: 'hero-art__foot' },
          h('p', null, h('span', { text: '从你我之间' }), h('strong', { text: '到校园的每一天。' })),
          h('a', { class: 'hero-art__link', href: '/community' },
            h('span', { text: '发现温暖连接' }), icon('arrowRight', 'ico ico--sm')))),
      figuresSlot,
    ),
  );

  const node = h(
    'div',
    { class: 'view home-page' },
    hero,
    h(
      'section',
      { class: 'psection' },
      h(
        'div',
        { class: 'psection__head' },
        h(
          'div',
          { class: 'psection__head-text' },
          h('h2', { class: 't-h1', text: '近期活动' }),
          h('p', { class: 't-secondary', text: '查看活动详情，选择合适的场次报名。' }),
        ),
        h('span', { class: 'spacer' }),
        button({ label: '查看全部活动', variant: 'secondary', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' }),
      ),
      railSlot,
    ),
    h(
      'section',
      { class: 'psection psection--sunken' },
      h(
        'div',
        { class: 'psection__inner' },
        h(
          'div',
          { class: 'psection__head' },
          h(
            'div',
            { class: 'psection__head-text' },
            h('h2', { class: 't-h1', text: '项目与服务' }),
            h('p', { class: 't-secondary', text: '参与活动、分享创作、连接同伴，让校园里的热心有处可去。' }),
          ),
        ),
        programsSlot,
      ),
    ),
    h('section', {class:'psection home-trust', aria:{label:'参与与隐私'}},
      icon('shield', 'ico'),
      h('div', null, h('h2', {class:'t-h3',text:'安心参与，清楚了解每一步'}),
        h('p', {text:'校园邮箱验证 · 参与记录可查 · 个人资料按权限访问'})),
      button({label:'平台与隐私说明',href:'/about',variant:'ghost',iconAfter:'arrowRight'})),
  );

  let releaseCounters = () => {};

  // Progressive load: structure is already on screen, data arrives next.
  const catalogRequest = publicApi.events().then(catalog => {
      const { blood, ordinary } = activityPresentation(catalog.events.filter(event => event.status === '报名中'));
      if (ordinary.length || blood.length) {
        const featured = blood.length ? bloodEntry(blood) : eventCard(ordinary[0]);
        const rest = blood.length ? ordinary : ordinary.slice(1);
        const rail = h('div', { class: `home-activities${rest.length ? ' home-activities--multiple' : ' home-activities--single'}` },
          h('div', {class:'home-activities__featured'}, featured),
          rest.length ? h('div', {class:'home-activities__list'}, ...rest.slice(0,5).map(eventRow)) : null);
        railSlot.replaceChildren(rail);
      } else {
        railSlot.replaceChildren(
          emptyState({
            iconName: 'calendar',
            title: '目前没有开放报名的活动',
            description: '新的急救培训、公益活动与生命教育课程发布后会第一时间出现在这里。你也可以先了解其他服务通道。',
            actions: [button({ label: '逛逛内建广场', variant: 'primary', iconName: 'heart', href: '/community' }), button({ label: '查看历史活动', variant: 'ghost', href: '/events' })],
          }),
        );
      }
      return catalog;
  });
  Promise.all([catalogRequest, publicApi.overview()])
    .then(([catalog, payload]) => {
      const { blood, ordinary } = activityPresentation(catalog.events.filter(event => event.status === '报名中'));
      figuresSlot.replaceChildren(
        figure(ordinary.length + (blood.length ? 1 : 0), '正在开放报名的活动'),
        figure(payload.stats.openSeats, '剩余名额'),
        figure(payload.stats.totalRegistrations, '累计报名人次'),
        figure(payload.stats.inventoryCategories, '可借用物资品类'),
      );
      figuresSlot.setAttribute('aria-busy', 'false');





    })
    .catch((error) => {
      figuresSlot.setAttribute('aria-busy', 'false');
      figuresSlot.replaceChildren(h('p',{class:'hero__stats-error',text:'参与概览暂未更新，请稍后再试。'}));
      if (!railSlot.querySelector('.home-activities')) railSlot.replaceChildren(errorState({ title: '暂时无法读取活动数据', error, onRetry: () => navigate('/', { replace: true }) }));

    });

  return {
    title: '首页',
    node,
    dispose: () => {
      releaseCounters();
    },
  };
}
