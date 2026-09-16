/* ==========================================================================
   portal/pages/home.js
   Task: a visitor lands here to answer "what can I join, and how do I start?"
   Structure: intent-led hero → live openings → service programmes → trust.
   ========================================================================== */

import { h, icon, setVars } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { parallax, countOnVisible, stagger, spotlight, rememberOrigin } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { button, badge, statusIndicator, emptyState, errorState, skeletonBlock, barTrack } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';

function figure(value, label, { suffix = '' } = {}) {
  return h(
    'div',
    { class: 'hero__figure' },
    h('b', { data: { count: Number(value) || 0 }, text: '0' }),
    h('span', { text: suffix ? `${label} · ${suffix}` : label }),
  );
}

export function eventCard(event, { compact = false } = {}) {
  const seatRatio = event.capacity ? fmt.ratio(event.confirmed, event.capacity) : 0;
  const until = fmt.daysUntil(event.registrationEnd);
  const node = h(
    'a',
    {
      class: 'event spotlight',
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
        ? statusIndicator(event.full ? '名额已满 · 可候补' : '报名中', { tone: event.full ? 'warning' : 'success', live: true })
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
      h('span', { class: 'event__fact' }, icon('clock', 'ico ico--sm'), h('span', { text: fmt.dateRange(event.startAt, event.endAt) })),
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
  spotlight(node);
  return node;
}

export default async function homePage() {
  const heroDepth = h('div', { class: 'hero__depth' });
  const heroCross = h('div', { class: 'hero__cross' });
  const figuresSlot = h('div', { class: 'hero__figures' });
  const railSlot = h('div', { class: 'stack-4' }, skeletonBlock('180px'));
  const programsSlot = h('div', { class: 'stack-4' });

  const hero = h(
    'section',
    { class: 'hero' },
    heroDepth,
    heroCross,
    h(
      'div',
      { class: 'hero__inner' },
      h(
        'div',
        { class: 'hero__lede' },
        h('span', { class: 'hero__eyebrow' }, icon('sparkle', 'ico ico--sm'), h('span', { text: '人道 · 博爱 · 奉献' })),
        h('h1', null, h('span', { text: '让每一次参与' }), h('em', { text: '都有回应' })),
        h('p', {
          class: 'hero__sub',
          text: '南京大学红十字会的公开服务入口：报名急救培训与公益活动、申请物资借用、投递宣传内容、加入温暖连接。每一条提交都有编号、状态与负责人，可以随时查询。',
        }),
        h(
          'div',
          { class: 'hero__cta' },
          button({ label: '浏览开放活动', variant: 'primary', size: 'lg', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' }),
          button({ label: '查询我的记录', variant: 'inverse', size: 'lg', iconName: 'target', href: '/status' }),
        ),
      ),
      figuresSlot,
    ),
  );

  const node = h(
    'div',
    { class: 'view' },
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
          h('p', { class: 't-label', text: '正在开放报名' }),
          h('h2', { class: 't-h1', text: '近期活动' }),
          h('p', { class: 't-secondary', text: '名额与候补顺序由服务端实时计算；报名成功后会立即生成你的签到凭证。' }),
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
            h('p', { class: 't-label', text: '我们提供什么' }),
            h('h2', { class: 't-h1', text: '四条常用服务通道' }),
            h('p', { class: 't-secondary', text: '每条通道都有明确的责任人、审核环节与状态反馈，而不是把表单丢进邮箱。' }),
          ),
        ),
        programsSlot,
      ),
    ),
    h(
      'section',
      { class: 'psection psection--tight' },
      h(
        'div',
        { class: 'psection__head' },
        h(
          'div',
          { class: 'psection__head-text' },
          h('p', { class: 't-label', text: '关于你的信息' }),
          h('h2', { class: 't-h2', text: '我们只收集完成这件事所必需的内容' }),
        ),
        h('span', { class: 'spacer' }),
        button({ label: '平台与隐私说明', variant: 'ghost', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/about' }),
      ),
      h(
        'div',
        { class: 'programs' },
        ...[
          ['lock', '联系方式不公开', '公开页面不会展示手机号、微信、学号或身份证等信息；管理端按字段权限访问，并留有审计记录。'],
          ['shield', '同意可以撤回', '温暖连接等项目必须主动加入，任何时候都可以退出，退出后不再进入匹配与发送队列。'],
          ['eye', '状态可以自查', '报名、借用与投稿都会返回编号，用编号即可在「我的状态」中查询当前进展。'],
        ].map(([iconName, title, body]) =>
          h(
            'div',
            { class: 'program' },
            h('span', { class: 'program__icon' }, icon(iconName, 'ico ico--lg')),
            h('div', { class: 'program__body' }, h('h3', { class: 't-h3', text: title }), h('p', { class: 't-secondary', text: body })),
          ),
        ),
      ),
    ),
  );

  const releaseParallax = parallax(heroDepth, [
    { x: '--hx', y: '--hy', depth: 26, target: heroDepth },
    { x: '--cx', y: '--cy', depth: 54, target: heroCross },
  ]);

  let releaseCounters = () => {};

  // Progressive load: structure is already on screen, data arrives next.
  publicApi
    .overview()
    .then((payload) => {
      figuresSlot.replaceChildren(
        figure(payload.stats.openEvents, '正在开放报名的活动'),
        figure(payload.stats.openSeats, '剩余名额'),
        figure(payload.stats.totalRegistrations, '累计报名人次'),
        figure(payload.stats.inventoryCategories, '可借用物资品类'),
      );
      releaseCounters = countOnVisible(figuresSlot);

      if (payload.featured.length) {
        const rail = h('div', { class: 'rail' }, ...payload.featured.map((event) => eventCard(event)));
        stagger(rail);
        railSlot.replaceChildren(rail);
      } else {
        railSlot.replaceChildren(
          emptyState({
            iconName: 'calendar',
            title: '目前没有开放报名的活动',
            description: '新的急救培训、公益活动与生命教育课程发布后会第一时间出现在这里。你也可以先了解其他服务通道。',
            actions: [button({ label: '了解温暖连接', variant: 'primary', iconName: 'heart', href: '/warmth' }), button({ label: '查看历史活动', variant: 'ghost', href: '/events' })],
          }),
        );
      }

      const programs = h(
        'div',
        { class: 'programs' },
        ...payload.programs.map((program) =>
          h(
            'a',
            { class: 'program', href: program.action },
            h('span', { class: 'program__icon' }, icon(program.iconName || 'sparkle', 'ico ico--lg')),
            h('div', { class: 'program__body' }, h('h3', { class: 't-h3', text: program.name }), h('p', { class: 't-secondary', text: program.summary })),
            h('span', { class: 'event__go' }, icon('arrowRight', 'ico')),
          ),
        ),
      );
      stagger(programs);
      programsSlot.replaceChildren(programs);
    })
    .catch((error) => {
      figuresSlot.replaceChildren();
      railSlot.replaceChildren(errorState({ title: '暂时无法读取活动数据', error, onRetry: () => navigate('/', { replace: true }) }));
      programsSlot.replaceChildren();
    });

  return {
    title: '首页',
    node,
    dispose: () => {
      releaseParallax();
      releaseCounters();
    },
  };
}
