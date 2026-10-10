import { eventRow } from '../activity-row.js';
import { filterSegments } from '../../ui/filter-segments.js';
/* ==========================================================================
   portal/pages/events.js
   Task: find a joinable activity fast. Filters are URL-addressable so a link
   can be shared, and list changes animate instead of snapping.
   ========================================================================== */

import { searchField } from '../../ui/search-field.js';
import { h, qsa } from '../../core/dom.js';
import { bloodEntry } from '../blood-entry.js';
import { EVENT_CATEGORIES, eventCategory } from '../event-category.js';
import { publicApi, peekPublicResponse } from '../../core/api.js';
import { captureRects, playFlip } from '../../core/motion.js';
import { navigate, patchQuery } from '../../core/router.js';
import { button, chip, emptyState, errorState, skeletonBlock } from '../../ui/primitives.js';

let hasVisited = false;
export default async function eventsPage(context) {
  const state = {
    status: context.query.get('status') || '',
    category: EVENT_CATEGORIES.some(c => c.value === context.query.get('category')) ? context.query.get('category') : '',
    campus: context.query.get('campus') || '',
    q: context.query.get('q') || '',
  };

  const listSlot = h('div', { class: 'stack-4 discovery-results' }, skeletonBlock('120px'), skeletonBlock('120px'), skeletonBlock('120px'));
  const facetSlot = h('div', { class: 'row-2 row-wrap discovery-campus', hidden: true });
  const countNode = h('p', { class: 't-caption',role:'status',aria:{live:'polite',atomic:'true'} });
  const activeFilters=h('div',{class:'active-filters',role:'group',aria:{label:'当前筛选'},hidden:true});
  let keyboardInput=false;

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



  function clearFilters(){
    Object.assign(state,{q:'',status:'',campus:'',category:''});
    searchBox.setValue('');statusControl.setValue('');categoryControl.setValue('');
    renderFacets(campuses);apply();searchBox.input.focus();
  }
  function renderActiveFilters(){
    const labels={q:'搜索',status:'状态',category:'分类',campus:'校区'};
    const selected=Object.keys(labels).filter(key=>state[key]);
    activeFilters.hidden=!selected.length;
    activeFilters.replaceChildren(...selected.map(key=>{
      const value=key==='category'?EVENT_CATEGORIES.find(item=>item.value===state[key])?.label:state[key];
      return button({label:`${labels[key]}：${value}`,ariaLabel:`清除${labels[key]}：${value}`,iconAfter:'close',variant:'secondary',size:'sm',onClick:()=>{
        state[key]='';
        if(key==='q')searchBox.setValue('');
        if(key==='status')statusControl.setValue('');
        if(key==='category')categoryControl.setValue('');
        renderFacets(campuses);apply();
        const control=key==='status'?statusControl:key==='category'?categoryControl:null;
        if(control)control.querySelector('[aria-checked="true"]').focus();else searchBox.input.focus();
      }});
    }),...(selected.length?[button({label:'重置全部',variant:'ghost',size:'sm',onClick:clearFilters})]:[]));
  }
  function apply({ persist = true } = {}) {
    renderActiveFilters();
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

    listSlot.dataset.count = String(filtered.length - bloodCount + (bloodCount ? 1 : 0));
    const previous = captureRects(qsa('[data-flip-key]', listSlot));
    if (!filtered.length) {
      listSlot.replaceChildren(
        emptyState({
          iconName: 'calendar',
          title: state.q || state.status || state.campus || state.category ? '没有符合条件的活动' : '暂时没有公开活动',
          description: state.q || state.status || state.campus || state.category
            ? '试试减少一个筛选条件，或清除筛选查看全部活动。'
            : '新的急救培训、无偿献血宣传与生命教育课程发布后会出现在这里。',
          actions: [
            state.q || state.status || state.campus || state.category
              ? button({
                  label: '清除筛选',
                  variant: 'secondary',
                  iconName: 'close',
                  onClick: clearFilters,
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
    if(!keyboardInput)playFlip(qsa('[data-flip-key]', listSlot), previous);
  }

  function renderFacets(campuses = []) {
    facetSlot.hidden = !campuses.length;
    facetSlot.replaceChildren(h('span', {class:'field__label',text:'校区'}),
      ...campuses.map((campus) =>
        chip(campus, {
          selected: state.campus === campus,
          onClick: () => {
            state.campus = state.campus === campus ? '' : campus;
            renderFacets(campuses);
            apply();
            [...facetSlot.querySelectorAll('button')].find(node=>node.textContent===campus)?.focus();
          },
        }),
      ),
    );
  }



  const node = h(
    'div',
    { class: 'view event-browser event-browser--aligned',on:{keydown:{handler:()=>{keyboardInput=true;},options:{capture:true}},pointerdown:()=>{keyboardInput=false;}} },
    h(
      'section',
      { class: 'psection psection--tight' },
      h(
        'div',
        { class: 'psection__head discovery-intro' },
        h(
          'div',
          { class: 'psection__head-text' },
          h('h1', { class: 't-h1', text: '选择活动，让善意发生' }),
          countNode,
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
          h('div', { class: 'discovery-filters__group' }, h('span', { class: 'field__label', text: '活动状态' }), statusControl),
          facetSlot, activeFilters),
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
  // A first mount can consume the boot prefetch. Route returns revalidate.
  const revalidate=Boolean(previous)&&hasVisited;
  hasVisited=true;
  publicApi.events({}, {fresh:revalidate})
    .then(show)
    .catch(error=>{
      if(disposed)return;
      const feedback=errorState({title:displayed?'活动更新暂未完成，正在显示此前列表':'活动列表无法加载',error,onRetry:()=>navigate('/events',{replace:true})});
      if(displayed)listSlot.append(feedback);else listSlot.replaceChildren(feedback);
    });

  return { title: '活动广场', node, dispose: () => {disposed=true;searchBox.dispose();} };
}
