import { h, icon } from '../core/dom.js';
import { button } from '../ui/primitives.js';

/** Number format shared with the hours card; keep one visual voice for all figures. */
export const formatHours = value => Number.isFinite(Number(value)) && value !== null && value !== undefined
  ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
  : '—';

const YEAR_TARGET_HOURS = 100;

/**
 * The hero and the records tab need the same account-scoped payload. Cache the
 * promise so a page render performs exactly one GET instead of two.
 */
export function createWorkflowFeed(request) {
  let pending;
  const feed = () => (pending ??= request('/api/portal/workflow/me').catch(error => {
    if (error?.code === 'workflow_disabled') return null;
    pending = undefined;   // 失败不缓存，重试才能真正重新发起请求
    throw error;
  }));
  feed.reset = () => { pending = undefined; };
  return feed;
}

/**
 * Member-centre hero: identity on the left, a printed-style hours instrument on
 * the right. Deliberately not a glass ring: paper surface, hairline rules and
 * tabular figures read as an official record, not a dashboard widget.
 */
export function memberHero({ request }) {
  const name = h('b', { class: 'mc-hero__name', text: '同学，你好' });
  const chips = h('div', { class: 'mc-hero__chips' });
  const total = h('b', { class: 'mc-dashboard__total', text: '—' });
  const year = h('b', { class: 'mc-dashboard__figure', text: '—' });
  const rank = h('b', { class: 'mc-dashboard__figure', text: '—' });
  const scale = h('div', { class: 'mc-dashboard__scale' }, h('span', { class: 'mc-dashboard__scale-fill' }));
  const note = h('p', { class: 'mc-dashboard__note', text: '数据来自志愿服务平台个人主页' });

  const dashboard = h('section', { class: 'mc-dashboard', role: 'group', aria: { label: '志愿时长档案' } },
    h('div', { class: 'mc-dashboard__head' },
      h('span', { class: 'mc-dashboard__seal', aria: { hidden: 'true' } }, icon('target', 'ico')),
      h('span', { class: 'mc-dashboard__eyebrow', text: '志愿时长档案' }),
      h('span', { class: 'mc-dashboard__code', text: 'VOLUNTEER HOURS' })),
    h('div', { class: 'mc-dashboard__cards' },
      h('div', { class: 'mc-hcard mc-hcard--lead' },
        h('p', { class: 'mc-hcard__label', text: '累计志愿时长' }),
        h('p', { class: 'mc-hcard__value' }, total, h('span', { class: 'mc-hcard__unit', text: 'h' }))),
      h('div', { class: 'mc-hcard' },
        h('p', { class: 'mc-hcard__label', text: '当前学年' }),
        h('p', { class: 'mc-hcard__value' }, year, h('span', { class: 'mc-hcard__unit', text: 'h' })),
        h('div', { class: 'mc-dashboard__gauge' }, scale,
          h('div', { class: 'mc-dashboard__gauge-legend' },
            h('span', { text: '0' }), h('span', { text: `学年目标 ${YEAR_TARGET_HOURS}h` })))),
      h('div', { class: 'mc-hcard' },
        h('p', { class: 'mc-hcard__label', text: '志愿时长排名' }),
        h('p', { class: 'mc-hcard__value' }, rank))),
    note);

  // 布局：上排身份（头像 + 姓名 + 资料标签 + 操作），下排三张等宽数据卡。
  // 以前是「大段营销文案 + 右侧窄条」，数据被挤成一条细缝，所以重排。
  const node = h('header', { class: 'mc-hero' },
    h('span', { class: 'mc-hero__glow', aria: { hidden: 'true' } }),
    h('div', { class: 'mc-hero__top' },
      h('div', { class: 'mc-hero__identity' },
        h('span', { class: 'mc-hero__avatar', aria: { hidden: 'true' } }, icon('user', 'ico')),
        h('div', { class: 'mc-hero__identity-text' },
          h('p', { class: 'mc-hero__eyebrow', text: 'MEMBER CENTER · 会员中心' }),
          name, chips)),
      h('div', { class: 'mc-hero__actions' },
        button({ label: '浏览活动', href: '/events', variant: 'primary', iconName: 'calendar' }),
        button({ label: '参与记录', href: '/me?view=records', variant: 'ghost', iconName: 'activity' }))),
    dashboard);

  /** 失败态与「0 小时」必须区分；重试带 fresh 绕过所有读缓存与在途请求。 */
  function showFailure() {
    dashboard.classList.add('mc-dashboard--failed');
    note.replaceChildren(
      h('span', { text: '时长暂时无法读取，数据未丢失。' }),
      button({
        label: '重新读取', variant: 'ghost', size: 'sm',
        onClick: () => { note.textContent = '正在重新读取…'; void load(true); },
      }));
  }

  const load = (fresh = false) =>
    request(`/api/portal/workflow/hours${fresh ? `?fresh=${Date.now()}` : ''}`).then(data => {
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
    scale.style.setProperty('--mc-progress', `${Math.min(100, Math.max(0, Number((value / YEAR_TARGET_HOURS * 100).toFixed(2))))}%`);
    if (data.hoursUnavailable) { showFailure(); return; }
    note.textContent = hours ? '数据来自志愿服务平台个人主页'
      : '尚未在志愿服务平台匹配到时长记录（按姓名＋学号）';
    dashboard.classList.remove('mc-dashboard--failed');
  }).catch(showFailure);
  load();
  return node;
}
