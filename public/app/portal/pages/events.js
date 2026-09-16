/* ==========================================================================
   portal/pages/events.js
   Task: find a joinable activity fast. Filters are URL-addressable so a link
   can be shared, and list changes animate instead of snapping.
   ========================================================================== */

import { h, icon, qsa } from '../../core/dom.js';
import { publicApi } from '../../core/api.js';
import { captureRects, playFlip, stagger, rememberOrigin } from '../../core/motion.js';
import { navigate, patchQuery } from '../../core/router.js';
import { button, chip, badge, statusIndicator, segmented, emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';

function eventRow(event) {
  const node = h(
    'a',
    {
      class: 'event-row',
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
      { class: 'event-row__date' },
      h('b', { text: fmt.dayOfMonth(event.startAt || event.registrationEnd) }),
      h('span', { text: fmt.monthLabel(event.startAt || event.registrationEnd) || '待定' }),
    ),
    h(
      'div',
      { class: 'event-row__body' },
      h(
        'div',
        { class: 'row-2 row-wrap' },
        badge(event.type || '公益活动', { tone: 'accent' }),
        event.status === '报名中'
          ? statusIndicator(event.full ? '名额已满 · 可候补' : `剩余 ${event.remaining} 个名额`, { tone: event.full ? 'warning' : 'success', live: true })
          : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
      ),
      h('h3', { class: 't-h3 t-clamp-1', text: event.name }),
      h(
        'div',
        { class: 'row-4 row-wrap' },
        h('span', { class: 'event__fact' }, icon('clock', 'ico ico--sm'), h('span', { text: fmt.dateRange(event.startAt, event.endAt) })),
        h('span', { class: 'event__fact' }, icon('pin', 'ico ico--sm'), h('span', { text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
        event.sessions.length > 1 ? h('span', { class: 'event__fact' }, icon('list', 'ico ico--sm'), h('span', { text: `${event.sessions.length} 个场次` })) : null,
      ),
    ),
    button({
      label: event.status === '报名中' ? (event.full ? '加入候补' : '查看并报名') : '查看详情',
      variant: event.status === '报名中' ? 'primary' : 'secondary',
      iconAfter: 'arrowRight',
      iconMotion: 'nudge',
    }),
  );
  return node;
}

export default async function eventsPage(context) {
  const state = {
    status: context.query.get('status') || '',
    campus: context.query.get('campus') || '',
    q: context.query.get('q') || '',
  };

  const listSlot = h('div', { class: 'stack-4' }, skeletonBlock('120px'), skeletonBlock('120px'), skeletonBlock('120px'));
  const facetSlot = h('div', { class: 'row-2 row-wrap' });
  const countNode = h('p', { class: 't-caption' });

  const search = h('input', {
    class: 'input',
    type: 'search',
    value: state.q,
    placeholder: '搜索活动名称、类型或地点',
    attrs: { 'aria-label': '搜索活动' },
  });

  const statusControl = segmented({
    items: [
      { value: '', label: '全部' },
      { value: '报名中', label: '报名中' },
      { value: '进行中', label: '进行中' },
      { value: '已结束', label: '已结束' },
    ],
    value: state.status,
    onChange: (value) => {
      state.status = value;
      statusControl.setValue(value);
      apply();
    },
    ariaLabel: '按状态筛选',
  });

  let all = [];

  function apply({ persist = true } = {}) {
    if (persist) patchQuery({ status: state.status, campus: state.campus, q: state.q });
    const needle = state.q.trim().toLowerCase();
    const filtered = all.filter((event) => {
      if (state.status && event.status !== state.status) return false;
      if (state.campus && event.campus !== state.campus) return false;
      if (needle && !`${event.name} ${event.type} ${event.description} ${event.location}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    countNode.textContent = `共 ${filtered.length} 场活动${state.status ? ` · ${state.status}` : ''}`;

    const previous = captureRects(qsa('[data-flip-key]', listSlot));
    if (!filtered.length) {
      listSlot.replaceChildren(
        emptyState({
          iconName: 'calendar',
          title: state.q || state.status || state.campus ? '没有符合条件的活动' : '暂时没有公开活动',
          description: state.q || state.status || state.campus
            ? '可以清除筛选条件再看一次，或者留下投稿与借用申请，我们会在新活动发布时同步公告。'
            : '新的急救培训、无偿献血宣传与生命教育课程发布后会出现在这里。',
          actions: [
            state.q || state.status || state.campus
              ? button({
                  label: '清除筛选',
                  variant: 'secondary',
                  iconName: 'close',
                  onClick: () => {
                    state.q = '';
                    state.status = '';
                    state.campus = '';
                    search.value = '';
                    statusControl.setValue('');
                    renderFacets();
                    apply();
                  },
                })
              : button({ label: '了解温暖连接', variant: 'primary', iconName: 'heart', href: '/warmth' }),
          ],
        }),
      );
      return;
    }
    const list = h('div', { class: 'event-list' }, ...filtered.map(eventRow));
    stagger(list);
    listSlot.replaceChildren(list);
    playFlip(qsa('[data-flip-key]', listSlot), previous);
  }

  function renderFacets(campuses = []) {
    facetSlot.replaceChildren(
      ...campuses.map((campus) =>
        chip(campus, {
          selected: state.campus === campus,
          onClick: () => {
            state.campus = state.campus === campus ? '' : campus;
            renderFacets(campuses);
            apply();
          },
        }),
      ),
    );
  }

  search.addEventListener('input', () => {
    state.q = search.value;
    apply();
  });

  const node = h(
    'div',
    { class: 'view' },
    h(
      'section',
      { class: 'psection psection--tight' },
      h(
        'div',
        { class: 'psection__head' },
        h(
          'div',
          { class: 'psection__head-text' },
          h('p', { class: 't-label', text: '活动广场' }),
          h('h1', { class: 't-h1', text: '选择一场活动，开始参与' }),
          h('p', { class: 't-secondary', text: '名额与候补顺序在服务端实时计算；同一邮箱不能重复报名同一活动。' }),
        ),
      ),
      h(
        'div',
        { class: 'stack-5' },
        h('div', { class: 'row-4 row-wrap' }, h('div', { class: 'input-group events__search' }, icon('search', 'ico ico--sm'), search), statusControl, h('span', { class: 'spacer' }), countNode),
        facetSlot,
        listSlot,
      ),
    ),
  );

  publicApi
    .events()
    .then((payload) => {
      all = payload.events;
      renderFacets(payload.facets.campuses);
      apply({ persist: false });
    })
    .catch((error) => {
      listSlot.replaceChildren(errorState({ title: '活动列表无法加载', error, onRetry: () => navigate('/events', { replace: true }) }));
    });

  return { title: '活动报名', node };
}
