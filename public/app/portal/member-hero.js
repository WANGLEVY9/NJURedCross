import { h, icon } from '../core/dom.js';
import { button } from '../ui/primitives.js';

/** Number format shared with the hours card; keep one visual voice for all figures. */
export const formatHours = value => Number.isFinite(Number(value)) && value !== null && value !== undefined
  ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
  : '—';

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
 * Member-centre hero: identity on the left, official hours on the right.
 * Figures are filled once the shared feed resolves; the static skeleton stays
 * usable when the workflow service is unavailable.
 */
export function memberHero({ feed }) {
  const name = h('b', { class: 'mc-hero__name', text: '同学，你好' });
  const chips = h('div', { class: 'mc-hero__chips' });
  const total = h('strong', { class: 'mc-hero__value', text: '—' });
  const yearValue = h('b', { class: 'mc-hero__ring-value', text: '—' });
  const ring = h('div', { class: 'mc-hero__ring', vars: { '--mc-progress': '0%' } },
    h('div', { class: 'mc-hero__ring-inner' }, yearValue,
      h('span', { class: 'mc-hero__ring-label', text: '学年 60h' })));

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
    h('div', { class: 'mc-hero__score' },
      h('p', { class: 'mc-hero__score-label', text: '累计志愿时长' }),
      h('p', { class: 'mc-hero__score-number' }, total, h('span', { text: '小时' })),
      h('p', { class: 'mc-hero__score-note', text: '来自志愿服务平台个人主页' }),
      ring));

  feed().then(data => {
    if (!data) return;
    const person = data.participant || {};
    if (person.realName) name.textContent = `${person.realName}，你好`;
    const parts = [['学号', person.studentId], ['院系', person.department], ['年级', person.grade]]
      .filter(([, value]) => value)
      .map(([label, value]) => h('span', { class: 'mc-chip', text: `${label} ${value}` }));
    if (data.platformHours) parts.push(h('span', { class: 'mc-chip mc-chip--verified', text: '已关联志愿服务平台' }));
    chips.replaceChildren(...parts);
    total.textContent = formatHours(data.platformHours?.totalHours);
    const year = Number(data.platformHours?.academicYearHours) || 0;
    yearValue.textContent = `${formatHours(year)}h`;
    ring.style.setProperty('--mc-progress', `${Math.min(100, Math.max(0, Math.round(year / 60 * 100)))}%`);
  }).catch(() => {});
  return node;
}
