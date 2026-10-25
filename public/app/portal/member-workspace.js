import { h, setVars } from '../core/dom.js';
import { button, notice, badge } from '../ui/primitives.js';
import { patchQuery } from '../core/router.js';

/** Keep forms mounted while switching views, so unsaved edits stay intact. */
export function memberWorkspace({ profile, records, warmth, skills }) {
  const entries = [
    { value: 'profile', label: '个人资料', node: profile },
    { value: 'records', label: '参与记录', node: records },
    // v3 S5：技能面板仅在调用方提供时出现（旧路径不传则隐藏）。
    ...(skills ? [{ value: 'skills', label: '我的技能', node: skills }] : []),
    { value: 'warmth', label: '温暖连接', node: warmth },
  ];
  const query = new URLSearchParams(location.search);
  let active = entries.some(item => item.value === query.get('view')) ? query.get('view') : 'profile';
  const requested = query.get('focus') || location.hash.slice(1);
  if (requested.startsWith('member-warmth')) active = 'warmth';
  else if (requested.startsWith('member-skills')) active = 'skills';
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
  const records = data.registrations || [];
  const pending = (data.ledger || []).filter(row => ['待批准', '已批准'].includes(row.status)).length;
  const format = value => Number.isFinite(Number(value)) && value !== null && value !== undefined ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value)) : '—';
  return h('section', { class: 'panel member-hours' },
    h('header', { class: 'panel__head' }, h('h2', { class: 't-h2', text: '活动志愿时长' }),
      button({ label: '查看活动与报名状态', href: '/workflow-events?view=records', variant: 'secondary', size: 'sm' })),
    h('div', { class: 'panel__body stack-4' },
      h('p', { class: 't-caption', text: '以下时长来自「南大红会 志愿服务平台」个人主页，按姓名＋学号匹配；报名成功或已签到不代表时长已入账。' }),
      h('dl', { class: 'member-hours__metrics' },
        ...[['总志愿时长', data.platformHours?.totalHours], ['学年志愿时长', data.platformHours?.academicYearHours]].map(([label, value]) =>
          h('div', null, h('dt', { text: label }), h('dd', null, h('strong', { text: format(value) }), h('span', { text: '小时' }))))),
      !data.platformHours ? notice('尚未在志愿服务平台匹配到你的时长记录（按姓名＋学号匹配）。如刚注册或有疑问，请联系管理员核对平台资料中的姓名与学号。', { tone: 'neutral' }) : null,
      pending ? notice(`${pending} 条时长记录正在核对或等待入账，尚未计入以上统计。`, { tone: 'info' }) : null,
      h('section', { class: 'member-hours__records', 'aria-label': '活动报名进度' },
        h('h3', { class: 't-h3', text: '活动报名进度' }),
        ...records.map(record => h('article', { class: 'member-hours__record' },
          h('div', { class: 'stack-2' }, h('b', { text: record.eventName || '活动报名' }),
            h('p', { class: 't-caption', text: [record.date, record.slot, record.location].filter(Boolean).join(' · ') })),
          h('div', { class: 'member-hours__record-actions' },
            badge(record.entryStatus === '网站已入账' ? '时长已入账' : record.status === '已签到' ? '已签到 · 待核对时长' : record.result || record.status || '待处理', { tone: record.entryStatus === '网站已入账' ? 'success' : 'neutral' }),
            button({ label: '查看报名进度', href: `/workflow-events?view=records&registration=${encodeURIComponent(record.code)}`, variant: 'ghost', size: 'sm' })))),
        !records.length ? h('div', { class: 'stack-3' }, h('p', { class: 't-secondary', text: '尚无活动报名记录。选择合适的活动，开始积累你的参与记录。' }), button({ label: '浏览开放活动', href: '/events', variant: 'secondary', size: 'sm' })) : null)));
}

/** Display only: the server remains the authority for membership and permissions. */
export function memberDepartment(value) {
  const label = String(value || '').trim() || '未登记';
  const tones = { 主席团: 'presidium', 生命: 'life', 生命中心: 'life', 博爱: 'care', 博爱中心: 'care', 综事: 'affairs', 综事中心: 'affairs' };
  const tone = tones[label];
  return h('span', { class: tone ? `member-department member-department--${tone}` : 'member-department-plain', text: label });
}
