/* ==========================================================================
   portal/pages/events.js
   Task: find a joinable activity fast. Filters are URL-addressable so a link
   can be shared, and list changes animate instead of snapping.
   ========================================================================== */

import { h, icon, qsa } from '../../core/dom.js';
import { bloodEntry } from '../blood-entry.js';
import { EVENT_CATEGORIES, eventCategory, EVENT_CAMPUSES, campusName } from '../event-category.js';
import { publicApi } from '../../core/api.js';
import { captureRects, playFlip, rememberOrigin } from '../../core/motion.js';
import { navigate, patchQuery } from '../../core/router.js';
import { button, badge, statusIndicator, segmented, field, emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';
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
          ? statusIndicator(event.full ? (event.workflowId ? '名额已满' : '名额已满 · 可候补') : `剩余 ${event.remaining} 个名额`, { tone: event.full ? 'warning' : 'success', live: true })
          : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
      ),
      h('h3', { class: 't-h3 t-clamp-1', text: event.name }),
      h(
        'div',
        { class: 'row-4 row-wrap' },
        h('span', { class: 'event__fact' }, icon('clock', 'ico ico--sm'), h('span', { text: event.schedule || fmt.dateRange(event.startAt, event.endAt) })),
        h('span', { class: 'event__fact' }, icon('pin', 'ico ico--sm'), h('span', { text: [event.campus, event.location].filter(Boolean).join(' · ') || '地点待公布' })),
        event.sessions?.length > 1 ? h('span', { class: 'event__fact' }, icon('list', 'ico ico--sm'), h('span', { text: `${event.sessions.length} 个场次` })) : null,
      ),
    ),
    h('span', { class: 'event-row__action' }, h('span', { text: '查看详情' }), icon('arrowRight', 'ico ico--sm')),
  );
  return node;
}

export default async function eventsPage(context) {
  const state = {
    status: context.query.get('status') || '',
    category: EVENT_CATEGORIES.some(c => c.value === context.query.get('category')) ? context.query.get('category') : '',
    campus: campusName(context.query.get('campus')),
    q: context.query.get('q') || '',
  };

  const listSlot = h('div', { class: 'stack-4' }, skeletonBlock('120px'), skeletonBlock('120px'), skeletonBlock('120px'));
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

  const categoryControl = field({ label: '地区', name: 'event-category', value: state.category, options: EVENT_CATEGORIES.map((c) => ({ value: c.value, label: c.value === '' ? '全部地区' : c.label })), onInput: () => { state.category = categoryControl.control.value; apply(); } });
  categoryControl.classList.add('events__category', 'field--silent');

  // Always offer the main campuses, even when there are no current activities.
  const campusControl = field({ label: '校区', name: 'event-campus', value: state.campus, options: [{ value: '', label: '全部校区' }, ...EVENT_CAMPUSES.map(value=>({value,label:value}))], onInput: () => { state.campus = campusControl.control.value; apply(); } });
  campusControl.classList.add('events__campus', 'field--silent');

  let all = [];



  function apply({ persist = true } = {}) {
    if (persist) patchQuery({ status: state.status, campus: state.campus, category: state.category, q: state.q });
    const needle = state.q.trim().toLowerCase();
    const filtered = all.filter((event) => {
      if (state.category && eventCategory(event) !== state.category) return false;
      if (state.status && event.status !== state.status) return false;
      if (state.campus && campusName(event.campus) !== state.campus) return false;
      if (needle && !`${event.name} ${event.type} ${event.description} ${event.location}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    const bloodCount = filtered.filter(event => eventCategory(event) === 'blood').length;
    countNode.textContent = bloodCount ? `${filtered.length - bloodCount + 1} 项活动 · 献血车 ${bloodCount} 个班次` : `共 ${filtered.length} 场活动`;
    if (bloodCount === filtered.length && bloodCount) countNode.textContent = `1 项献血车活动 · ${bloodCount} 个班次`;

    const previous = captureRects(qsa('[data-flip-key]', listSlot));
    if (!filtered.length) {
      listSlot.replaceChildren(
        emptyState({
          iconName: 'calendar',
          title: state.q || state.status || state.campus || state.category ? '没有符合条件的活动' : '暂时没有公开活动',
          description: state.q || state.status || state.campus || state.category
            ? '可以清除筛选条件再看一次，或者留下投稿与借用申请，我们会在新活动发布时同步公告。'
            : '新的急救培训、无偿献血宣传与生命教育课程发布后会出现在这里。',
          actions: [
            state.q || state.status || state.campus || state.category
              ? button({
                  label: '清除筛选',
                  variant: 'secondary',
                  iconName: 'close',
                  onClick: () => {
                    state.q = '';
                    state.status = '';
                    state.campus = '';
                    state.category = '';
                    categoryControl.control.value = '';
                    campusControl.control.value = '';
                    search.value = '';
                    statusControl.setValue('');
                    apply();
                  },
                })
              : button({ label: '了解温暖连接', variant: 'primary', iconName: 'heart', href: '/warmth' }),
          ],
        }),
      );
      return;
    }
    const blood = filtered.filter(event => eventCategory(event) === 'blood');
    const ordinary = filtered.filter(event => eventCategory(event) !== 'blood');
    const sections = [];
    if (blood.length) {
      sections.push(bloodEntry(blood));

    }
    if (ordinary.length) sections.push(h('div', { class: 'event-list event-list--compact' }, ...ordinary.map(eventRow)));
    listSlot.replaceChildren(...sections);
    playFlip(qsa('[data-flip-key]', listSlot), previous);
  }

  search.addEventListener('input', () => {
    state.q = search.value;
    apply();
  });

  const node = h(
    'div',
    { class: 'view event-browser' },
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
          h('h1', { class: 't-h1', text: '选择活动，开始参与' }),
          h('p', { class: 't-secondary', text: '提交后可在会员中心查看报名进度。' }),
        ),
        h('span', { class: 'spacer' }),
        button({label:'我的报名',href:'/me',variant:'secondary',iconName:'user'}),
      ),
      h(
        'div',
        { class: 'stack-5' },
        h('div', { class: 'events__filters' }, h('div', { class: 'input-group events__search' }, icon('search', 'ico ico--sm'), search), categoryControl, campusControl, statusControl, h('span', { class: 'spacer' }), countNode),
        listSlot,
      ),
    ),
  );

  publicApi
    .events()
    .then((payload) => {
      all = payload.events;
      const campuses=new Set(EVENT_CAMPUSES);
      for (const raw of payload.facets.campuses) {
        const campus=campusName(raw);
        if(campus&&!campuses.has(campus)){campuses.add(campus);campusControl.control.append(h('option', { value: campus, text: campus }));}
      }
      campusControl.control.value = state.campus;
      apply({ persist: false });
    })
    .catch((error) => {
      listSlot.replaceChildren(errorState({ title: '活动列表无法加载', error, onRetry: () => navigate('/events', { replace: true }) }));
    });

  return { title: '活动广场', node };
}
