import { eventRow } from '../activity-row.js';
import { preloadEventFonts } from '../events-fonts.js';
import { filterSegments } from '../../ui/filter-segments.js';
import { eventsHero, eventsCategories, eventsGuide } from '../events-showcase.js';
/* ==========================================================================
   portal/pages/events.js
   Task: find a joinable activity fast. Filters are URL-addressable so a link
   can be shared, and list changes animate instead of snapping.
   ========================================================================== */

import { searchField } from '../../ui/search-field.js';
import { h, qsa } from '../../core/dom.js';
import { bloodEntry } from '../blood-entry.js';
import { EVENT_CATEGORIES, eventCategory } from '../event-category.js';
import { activityKind, activityRegion, categoryFacets } from '../../shared/activity-taxonomy.js';
import { publicApi, peekPublicResponse } from '../../core/api.js';
import { captureRects, playFlip } from '../../core/motion.js';
import { navigate, patchQuery } from '../../core/router.js';
import { button, emptyState, errorState, skeletonBlock, field } from '../../ui/primitives.js';

let hasVisited = false;
export default async function eventsPage(context) {
  preloadEventFonts();
  const state = {
    status: context.query.get('status') || '',
    category: context.query.get('category') === 'blood' ? 'blood' : '',
    region: context.query.get('region') || (['nanjing','suzhou'].includes(context.query.get('category')) ? context.query.get('category') : ''),
    kind: context.query.get('kind') || '',
    campus: context.query.get('campus') || '',
    q: context.query.get('q') || '',
    order: context.query.get('order') === 'desc' ? 'desc' : 'asc',
  };

  const listSlot = h('div', { class: 'stack-4 discovery-results' }, skeletonBlock('120px'), skeletonBlock('120px'), skeletonBlock('120px'));
  const facetSlot = h('div', { class: 'events-campus-control' });
  const countNode = h('p', { class: 'sr-only',role:'status',aria:{live:'polite',atomic:'true'} });
  const activeFilters=h('div',{class:'active-filters',role:'group',aria:{label:'当前筛选'},hidden:true});
  let keyboardInput=false;

  const searchBox = searchField({ value: state.q, label: '搜索活动', placeholder: '搜索活动名称、类型或地点', onSearch: value => { state.q = value; apply(); } });
  const hero = eventsHero();
  const categories = eventsCategories(value => {
    state.kind = state.kind === value ? '' : value;
    kindField.control.value = state.kind;
    apply();
  });
  let campuses = [];

  const statusControl = field({label:'活动状态',name:'activity-status',value:state.status,
    options: [
      { value: '', label: '全部状态' },
      { value: '报名中', label: '报名中' },
      { value: '进行中', label: '进行中' },
      { value: '已结束', label: '已结束' },
    ],
    onInput: event => {state.status=event.target.value;apply();},
  });
  statusControl.setValue = value => {statusControl.control.value=value;};

  const regionControl = filterSegments({
    items: EVENT_CATEGORIES.filter(item => item.value !== 'blood').map(item => ({ ...item, compactLabel: { nanjing: '南京', suzhou: '苏州' }[item.value] })),
    value: state.region,
    ariaLabel: '按地区筛选',
    onChange: value => { state.region = value; apply(); },
  });
  const kindSlot = h('div', { class: 'discovery-filters__group' });
  let all = [];
  let kindField;
  function renderKinds(options) {
    options=[...new Set(options)];
    const counts=new Map();const programmes=new Set();
    for(const event of all){const key=eventCategory(event)==='blood'?'blood-programme':event.eventId;if(programmes.has(key))continue;programmes.add(key);const kind=activityKind(event);counts.set(kind,(counts.get(kind)||0)+1);}
    const choices=[{value:'',label:'全部类别',description:`${programmes.size} 项活动`},...options.map(value=>({value,label:value,description:`${counts.get(value)||0} 项活动`}))];
    if(kindField&&JSON.stringify([...kindField.control.options].map(o=>o.value))===JSON.stringify(choices.map(o=>o.value))){choices.forEach((o,i)=>{kindField.control.options[i].dataset.description=o.description;});kindField.querySelectorAll('.select-menu__description').forEach((node,i)=>{node.textContent=choices[i]?.description||'';});kindField.control.value=state.kind;return;}
    kindField = field({label:'活动类别',name:'activity-kind',value:state.kind,
      options:choices,
      onInput:event=>{state.kind=event.target.value;apply();}});
    kindField.classList.add('activity-category-field');
    kindSlot.replaceChildren(kindField);
  }
  renderKinds(categoryFacets([]));
  const sortControl = field({label:'排序方式',name:'activity-sort',value:state.order,searchable:false,
    options:[{value:'asc',label:'按活动时间'},{value:'desc',label:'时间由远到近'}],
    onInput:event=>{state.order=event.target.value;apply();}});
  sortControl.classList.add('events-toolbar-field');
  renderFacets();

  let disposed=false, displayed=false;



  function clearFilters(){
    Object.assign(state,{q:'',status:'',campus:'',category:'',region:'',kind:''});
    searchBox.setValue('');statusControl.setValue('');regionControl.setValue('');kindField.querySelector('select').value='';
    renderFacets(campuses);apply();searchBox.input.focus();
  }
  function renderActiveFilters(){
    const labels={q:'搜索',status:'状态',category:'专项',region:'地区',kind:'类别',campus:'校区'};
    const selected=Object.keys(labels).filter(key=>state[key]);
    activeFilters.hidden=!selected.length;
    activeFilters.replaceChildren(...selected.map(key=>{
      const value=['category','region'].includes(key)?EVENT_CATEGORIES.find(item=>item.value===state[key])?.label:state[key];
      return button({label:`${labels[key]}：${value}`,ariaLabel:`清除${labels[key]}：${value}`,iconAfter:'close',variant:'secondary',size:'sm',onClick:()=>{
        state[key]='';
        if(key==='q')searchBox.setValue('');
        if(key==='status')statusControl.setValue('');
        if(key==='region')regionControl.setValue('');
        if(key==='kind')kindField.querySelector('select').value='';
        renderFacets(campuses);apply();
        const control=key==='region'?regionControl:null;
        if(control)control.querySelector('[aria-checked="true"]').focus();else if(key==='campus')facetSlot.querySelector('[role="combobox"]')?.focus();else if(key==='status')statusControl.querySelector('[role="combobox"]')?.focus();else if(key==='kind')kindField.querySelector('[role="combobox"]')?.focus();else searchBox.input.focus();
      }});
    }),...(selected.length?[button({label:'重置全部',variant:'ghost',size:'sm',onClick:clearFilters})]:[]));
  }
  function apply({ persist = true } = {}) {
    renderActiveFilters();
    categories.setValue(state.kind);
    if (persist) patchQuery({ status: state.status, campus: state.campus, category: state.category, region:state.region, kind:state.kind, q: state.q, order:state.order==='desc'?'desc':'' });
    const needle = state.q.trim().toLowerCase();
    const filtered = all.filter((event) => {
      if (state.category && eventCategory(event) !== state.category) return false;
      if (state.region && activityRegion(event) !== state.region) return false;
      if (state.kind && activityKind(event) !== state.kind) return false;
      if (state.status && event.status !== state.status) return false;
      if (state.campus && event.campus !== state.campus) return false;
      if (needle && !`${event.name} ${event.type} ${event.description} ${event.location}`.toLowerCase().includes(needle)) return false;
      return true;
    }).sort((a,b) => (new Date(a.startAt || a.registrationEnd) - new Date(b.startAt || b.registrationEnd))*(state.order==='desc'?-1:1));

    const bloodCount = filtered.filter(event => eventCategory(event) === 'blood').length;
    countNode.textContent = `当前可查看 ${filtered.length - bloodCount + (bloodCount ? 1 : 0)} 项活动`;

    const count = filtered.length - bloodCount + (bloodCount ? 1 : 0);
    listSlot.dataset.count = String(count);
    listSlot.dataset.layout = count===0?'empty':count===1?'featured':count<5?'curated':'list';
    const previous = captureRects(qsa('[data-flip-key]', listSlot));
    if (!filtered.length) {
      listSlot.replaceChildren(
        emptyState({
          iconName: 'calendar',
          title: state.q || state.status || state.campus || state.category || state.region || state.kind ? '没有符合条件的活动' : '暂时没有公开活动',
          description: state.q || state.status || state.campus || state.category || state.region || state.kind
            ? '试试减少一个筛选条件，或清除筛选查看全部活动。'
            : '新的急救培训、无偿献血宣传与生命教育课程发布后会出现在这里。',
          actions: [
            state.q || state.status || state.campus || state.category || state.region || state.kind
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
    const rows = [...(blood.length ? [bloodEntry(blood, { list: true })] : []), ...ordinary.map(event => eventRow(event, {plaza:true}))];
    const startKey = row => {const time=Date.parse(row.dataset.startAt);return Number.isFinite(time)?time:Infinity;};
    rows.sort((a,b)=>(startKey(a)-startKey(b))*(state.order==='desc'?-1:1));
    const sections = [h('div', { class: 'event-list event-list--compact' }, ...rows.map(row => {
      const event = ordinary.find(item => item.eventId === row.dataset.flipKey);
      if(count===1){row.classList.add('event-row--featured');if(event?.description)row.querySelector('.event-row__body').append(h('p',{class:'featured-event-description',text:event.description}));}
      return row;
    }))];
    listSlot.replaceChildren(...sections);
    if(!keyboardInput)playFlip(qsa('[data-flip-key]', listSlot), previous);
  }

  function renderFacets(campuses = []) {
    const options=[...new Set([...campuses,...(state.campus?[state.campus]:[])])];
    const control=field({label:'按校区筛选',name:'activity-campus',value:state.campus,searchable:false,
      options:[{value:'',label:'按校区筛选'},...options.map(value=>({value,label:value}))],
      onInput:event=>{state.campus=event.target.value;apply();}});
    control.classList.add('events-toolbar-field');
    facetSlot.replaceChildren(control);
  }



  const node = h(
    'div',
    { class: 'view plaza-page events-page event-browser event-browser--aligned',on:{keydown:{handler:()=>{keyboardInput=true;},options:{capture:true}},pointerdown:()=>{keyboardInput=false;}} },
    h(
      'div',
      { class: 'plaza-frame' },
      hero.node,
      categories.node,
      h(
        'div',
        { class: 'stack-5' },
        h('div', { class: 'discovery-filters' },
          h('div', { class: 'discovery-filters__search' }, h('span', { class: 'field__label', text: '搜索活动' }), searchBox),
          kindSlot,
          h('div', { class: 'discovery-filters__group' }, h('span', { class: 'field__label', text: '活动状态' }), statusControl),
          h('div', { class: 'discovery-filters__group discovery-filters__region' }, h('span', { class: 'field__label', text: '地区' }), regionControl),
          activeFilters),
        h('div', { class: 'events-results-heading' }, h('h2', { text: '近期活动' }),
          h('div',{class:'events-results-controls'},facetSlot,sortControl)),
        countNode,
        listSlot,
        eventsGuide(),
      ),
    ),
  );

  function show(payload){
    if(disposed)return;
    all=payload.events;campuses=payload.facets.campuses;
    renderKinds(categoryFacets(all,payload.facets.categories));
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

  return { title: '活动广场', node, dispose: () => {disposed=true;hero.dispose();searchBox.dispose();delete document.documentElement.dataset.eventsTypography;} };
}
