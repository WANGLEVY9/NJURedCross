import { h, setVars } from '../core/dom.js';
import { button, notice } from '../ui/primitives.js';
import { patchQuery } from '../core/router.js';

/** Keep forms mounted while switching views, so unsaved edits stay intact. */
export function memberWorkspace({ profile, records, warmth }) {
  const entries = [
    { value: 'records', label: '参与记录', node: records },
    { value: 'profile', label: '个人资料', node: profile },
    { value: 'warmth', label: '温暖连接', node: warmth },
  ];
  const query = new URLSearchParams(location.search);
  let active = entries.some(item => item.value === query.get('view')) ? query.get('view') : 'records';
  const requested = query.get('focus') || location.hash.slice(1);
  if (requested.startsWith('member-warmth')) active = 'warmth';
  else if (requested === 'member-profile') active = 'profile';

  const buttons = entries.map(item => h('button', {
    type: 'button', role: 'tab', id: `member-tab-${item.value}`, text: item.label,
    aria: { controls: `member-view-${item.value}` },
    on: { click: () => show(item.value) },
  }));
  const tabs = h('div', { class: 'filter-segments member-tabs', role: 'tablist', aria: { label: '会员功能' }, vars: { '--choices': entries.length } },
    h('span', { class: 'filter-segments__indicator', aria: { hidden: 'true' } }), ...buttons);
  const panels = entries.map(item => h('div', {
    id: `member-view-${item.value}`, class: 'member-view stack-5', role: 'tabpanel', tabindex: '0',
    aria: { labelledby: `member-tab-${item.value}` },
  }, item.node));

  function show(value, persist = true) {
    const index = entries.findIndex(item => item.value === value);
    if (index < 0) return;
    active = value;
    setVars(tabs, { '--choice': index });
    buttons.forEach((button, i) => {
      button.setAttribute('aria-selected', String(i === index));
      button.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (persist) patchQuery({ view: active });
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    tabs.classList.add('filter-segments--keyboard');
    const current = entries.findIndex(item => item.value === active);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (current + (event.key === 'ArrowLeft' ? -1 : 1) + entries.length) % entries.length;
    show(entries[index].value);
    buttons[index].focus();
  });
  tabs.addEventListener('pointerdown', () => tabs.classList.remove('filter-segments--keyboard'));
  show(active, false);
  return {
    node: h('section', { class: 'member-workspace' }, tabs, ...panels),
    reveal(id) {
      const target = document.getElementById(id);
      const index = panels.findIndex(panel => target && panel.contains(target));
      if (index >= 0) show(entries[index].value);
    },
  };
}

/** Only display the hours returned by the account-scoped API. */
export function memberHours(data) {
  if (!data) return null;
  return h('section', { class: 'panel member-hours' },
    h('header', { class: 'panel__head' }, h('h2', { class: 't-h2', text: '活动志愿时长' }),
      button({ label: '查看活动与报名状态', href: '/workflow-events', variant: 'secondary', size: 'sm' })),
    h('div', { class: 'panel__body' }, data.profile ? h('dl', { class: 'member-hours__metrics' },
      ...[['已入账服务', data.profile.serviceHours], ['培训', data.profile.trainingHours], ['交通', data.profile.travelHours]].map(([label, value]) =>
        h('div', null, h('dt', { text: label }), h('dd', null, h('strong', { text: String(value ?? 0) }), h('span', { text: '小时' }))))) : notice('暂无活动时长记录。', { tone: 'neutral' })));
}
