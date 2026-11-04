import { h, icon } from '../core/dom.js';
import { button } from '../ui/primitives.js';

/** Number format shared with the hours card; keep one visual voice for all figures. */
export const formatHours = value => Number.isFinite(Number(value)) && value !== null && value !== undefined
  ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
  : '—';

const YEAR_TARGET_HOURS = 60;

/**
 * The hero and the records tab need the same account-scoped payload. Cache the
 * promise so a page render performs exactly one GET instead of two.
 */
export function createWorkflowFeed(request) {
  let pending;
  return () => (pending ??= request('/api/portal/workflow/me').catch(error => {
    if (error?.code === 'workflow_disabled') return null;
    throw error;
  }));
}

/**
 * Member-centre hero: identity on the left, a printed-style hours instrument on
 * the right. Deliberately not a glass ring: paper surface, hairline rules and
 * tabular figures read as an official record, not a dashboard widget.
 */
export function memberHero({ feed }) {
  const name = h('b', { class: 'mc-hero__name', text: '同学，你好' });
  const chips = h('div', { class: 'mc-hero__chips' });
  const total = h('strong', { class: 'mc-dashboard__total', text: '—' });
  const year = h('b', { class: 'mc-dashboard__figure', text: '—' });
  const rank = h('b', { class: 'mc-dashboard__figure', text: '—' });
  const scale = h('div', { class: 'mc-dashboard__scale' }, h('span', { class: 'mc-dashboard__scale-fill' }));
  const note = h('p', { class: 'mc-dashboard__note', text: '数据来自志愿服务平台个人主页' });

  const dashboard = h('div', { class: 'mc-dashboard', role: 'group', aria: { label: '志愿时长仪表盘' } },
    h('div', { class: 'mc-dashboard__head' },
      h('span', { class: 'mc-dashboard__seal', aria: { hidden: 'true' } }, icon('target', 'ico')),
      h('span', { class: 'mc-dashboard__eyebrow', text: '志愿时长档案' }),
      h('span', { class: 'mc-dashboard__code', text: 'VOLUNTEER HOURS' })),
    h('dl', { class: 'mc-dashboard__main' },
      h('dt', { text: '累计志愿时长' }),
      h('dd', null, total, h('span', { class: 'mc-dashboard__unit', text: 'h' }))),
    h('dl', { class: 'mc-dashboard__grid' },
      h('div', null, h('dt', { text: '当前学年' }), h('dd', null, year, h('span', { text: 'h' }))),
      h('div', null, h('dt', { text: '志愿时长排名' }), h('dd', null, rank))),
    h('div', { class: 'mc-dashboard__gauge' }, scale,
      h('div', { class: 'mc-dashboard__gauge-legend' },
        h('span', { text: '0' }), h('span', { text: `学年目标 ${YEAR_TARGET_HOURS}h` }))),
    note);

  const node = h('header', { class: 'mc-hero' },
    h('span', { class: 'mc-hero__glow', aria: { hidden: 'true' } }),
    h('div', { class: 'mc-hero__main' },
      h('p', { class: 'mc-hero__eyebrow', text: 'MEMBER CENTER · 会员中心' }),
      h('h1', { class: 'mc-hero__title', text: '每一份参与，都值得好好记录' }),
      h('p', { class: 'mc-hero__lede', text: '查看报名、投稿、志愿时长，与每场活动的进度。' }),
      h('div', { class: 'mc-hero__identity' },
        h('span', { class: 'mc-hero__avatar', aria: { hidden: 'true' } }, icon('user', 'ico')),
        h('div', { class: 'mc-hero__identity-text' }, name, chips)),
      h('div', { class: 'mc-hero__actions' },
        button({ label: '浏览活动', href: '/events', variant: 'primary', iconName: 'calendar' }),
        button({ label: '参与记录', href: '/me?view=records', variant: 'ghost', iconName: 'activity' }))),
    dashboard);

  feed().then(data => {
    if (!data) return;
    const person = data.participant || {};
    if (person.realName) name.textContent = `${person.realName}，你好`;
    const parts = [['学号', person.studentId], ['院系', person.department], ['年级', person.grade]]
      .filter(([, value]) => value)
      .map(([label, value]) => h('span', { class: 'mc-chip', text: `${label} ${value}` }));
    if (data.platformHours) parts.push(h('span', { class: 'mc-chip mc-chip--verified', text: '已关联志愿服务平台' }));
    chips.replaceChildren(...parts);

    const hours = data.platformHours;
    total.textContent = formatHours(hours?.totalHours);
    year.textContent = hours ? formatHours(hours.academicYearHours) : '—';
    rank.textContent = hours?.rank != null ? `第 ${formatHours(hours.rank)} 名` : '暂未排名';
    const value = Number(hours?.academicYearHours) || 0;
    scale.style.setProperty('--mc-progress', `${Math.min(100, Math.max(0, Math.round(value / YEAR_TARGET_HOURS * 100)))}%`);
    note.textContent = hours ? '数据来自志愿服务平台个人主页 · 由 NJUTable 更新'
      : '尚未在志愿服务平台匹配到时长记录（按姓名＋学号）';
  }).catch(() => {});
  return node;
}
