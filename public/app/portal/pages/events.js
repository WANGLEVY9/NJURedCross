import { registrationActions } from '../registration-actions.js';
import { filterSegments } from '../../ui/filter-segments.js';
/* ==========================================================================
   portal/pages/events.js
   Task: find a joinable activity fast. Filters are URL-addressable so a link
   can be shared, and list changes animate instead of snapping.
   ========================================================================== */

import { searchField } from '../../ui/search-field.js';
import { h, icon, qsa } from '../../core/dom.js';
import { bloodEntry } from '../blood-entry.js';
import { EVENT_CATEGORIES, eventCategory } from '../event-category.js';
import { publicApi, peekPublicResponse } from '../../core/api.js';
import { captureRects, playFlip } from '../../core/motion.js';
import { navigate, patchQuery } from '../../core/router.js';
import { button, chip, badge, statusIndicator, emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';

function eventRow(event) {
  const node = h(
    'article',
    {class:'event-row',data:{flipKey:event.eventId}},
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
    registrationActions({
      className: 'event-row__action',
      label: event.status === '报名中' && !event.full ? '查看并报名' : '查看详情',
      href: `/events/${encodeURIComponent(event.eventId)}`,
    }),
  );
  return node;
}

export default async function eventsPage(context) {
  const state = {
    status: context.query.get('status') || '',
    category: EVENT_CATEGORIES.some(c => c.value === context.query.get('category')) ? context.query.get('category') : '',
    campus: context.query.get('campus') || '',
    q: context.query.get('q') || '',
  };

  const listSlot = h('div', { class: 'stack-4' }, skeletonBlock('120px'), skeletonBlock('120px'), skeletonBlock('120px'));
  const facetSlot = h('div', { class: 'row-2 row-wrap' });
  const countNode = h('p', { class: 't-caption' });

  const searchBox = searchField({ value: state.q, label: '搜索活动', placeholder: '搜索活动名称、类型或地点', onSearch: value => { state.q = value; apply(); } });
  let campuses = [];

  const statusControl = filterSegments({
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

  const categoryControl = filterSegments({
    items: EVENT_CATEGORIES.map(item => ({ ...item, compactLabel: { nanjing: '南京', suzhou: '苏州', blood: '献血车' }[item.value] })),
    value: state.category,
    ariaLabel: '活动分类',
    onChange: value => { state.category = value; apply(); },
  });

  let all = [];
  let disposed=false, displayed=false;



  function apply({ persist = true } = {}) {
    if (persist) patchQuery({ status: state.status, campus: state.campus, category: state.category, q: state.q });
    const needle = state.q.trim().toLowerCase();
    const filtered = all.filter((event) => {
      if (state.category && eventCategory(event) !== state.category) return false;
      if (state.status && event.status !== state.status) return false;
      if (state.campus && event.campus !== state.campus) return false;
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
                    categoryControl.setValue('');
                    searchBox.setValue('');
                    statusControl.setValue('');
                    renderFacets(campuses);
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



  const node = h(
    'div',
    { class: 'view event-browser event-browser--aligned' },
    h(
      'section',
      { class: 'psection psection--tight' },
      h(
        'div',
        { class: 'psection__head discovery-intro' },
        h(
          'div',
          { class: 'psection__head-text' },
          h('p', { class: 'discovery-intro__eyebrow', text: '校园里的每一份热心，都有去处' }),
          h('h1', { class: 't-h1', text: '选择活动，让善意发生' }),
          h('p', { class: 't-secondary', text: '提交后可在会员中心查看报名进度。' }),
        ),
        h('div', { class: 'discovery-intro__account' },
          button({label:'我的报名',href:'/me',variant:'secondary',iconName:'user'}),
          h('span', { text: '查看报名进度与参与记录' })),
      ),
      h(
        'div',
        { class: 'stack-5' },
        h('div', { class: 'discovery-filters' },
          h('div', { class: 'discovery-filters__search' }, h('span', { class: 'field__label', text: '搜索活动' }), searchBox),
          h('div', { class: 'discovery-filters__group' }, h('span', { class: 'field__label', text: '活动分类' }), categoryControl),
          h('div', { class: 'discovery-filters__group' }, h('span', { class: 'field__label', text: '活动状态' }), statusControl)),
        h('div', { class: 'events-results', aria: { live: 'polite' } }, countNode),
        facetSlot,
        listSlot,
      ),
    ),
  );

  function show(payload){
    if(disposed)return;
    all=payload.events;campuses=payload.facets.campuses;
    renderFacets(campuses);apply({persist:false});displayed=true;
  }
  const previous=peekPublicResponse('/api/public/events');
  if(previous)show(previous);
  publicApi.events({}, {fresh:Boolean(previous)})
    .then(show)
    .catch(error=>{
      if(disposed)return;
      const feedback=errorState({title:displayed?'活动更新暂未完成，正在显示此前列表':'活动列表无法加载',error,onRetry:()=>navigate('/events',{replace:true})});
      if(displayed)listSlot.append(feedback);else listSlot.replaceChildren(feedback);
    });

  return { title: '活动广场', node, dispose: () => {disposed=true;searchBox.dispose();} };
}
