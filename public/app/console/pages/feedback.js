import { h, icon } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { badge, button, checkbox, emptyState, metric, metricRow, notice, pageHead, segmented } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';
import { asyncRegion } from '../lib.js';
import { notify, reportError } from '../../core/toast.js';

const CATEGORIES = ['活动', '物资', '内建', '宣传', '其他'];
const TONES = {
  活动: 'info',
  物资: 'warning',
  内建: 'success',
  宣传: 'accent',
  其他: 'neutral',
};

export default async function feedbackPage() {
  let filter = '全部';
  let statusFilter = '全部状态';
  let items = [];
  let truncated = false;

  const tabs = segmented({
    items: ['全部', ...CATEGORIES].map((value) => ({ value, label: value })),
    value: filter,
    ariaLabel: '按问题分类筛选',
    onChange: (value) => {
      filter = value;
      tabs.setValue(value);
      draw();
    },
  });
  const statusTabs = segmented({
    items: ['全部状态', '待解决', '已解决'].map((value) => ({ value, label: value })),
    value: statusFilter,
    ariaLabel: '按解决状态筛选',
    onChange: (value) => {
      statusFilter = value;
      statusTabs.setValue(value);
      draw();
    },
  });
  const totalMetric = metric({ label: '反馈总数', value: 0, unit: '条', animate: false });
  const categoryMetrics = new Map(CATEGORIES.map((category) => [
    category,
    metric({ label: category, value: 0, unit: '条', tone: category === '其他' ? '' : 'accent', animate: false }),
  ]));
  const metrics = metricRow([totalMetric, ...categoryMetrics.values()], { columns: 6 });
  const list = h('div', { class: 'feedback-list' });
  const empty = h('div');
  const summary = h('p', {
    class: 't-caption',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });

  function draw() {
    const shown = items.filter((item) => (
      (filter === '全部' || item.category === filter)
      && (statusFilter === '全部状态' || item.status === statusFilter)
    ));
    const resolved = items.filter((item) => item.resolved).length;
    totalMetric.setValue(items.length);
    for (const category of CATEGORIES) {
      categoryMetrics.get(category).setValue(items.filter((item) => item.category === category).length);
    }
    summary.textContent = `待解决 ${items.length - resolved} 条 · 已解决 ${resolved} 条 · 当前显示 ${shown.length} 条${truncated ? ' · 列表已达到读取上限' : ''}`;
    list.hidden = shown.length === 0;
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.replaceChildren(emptyState({
        iconName: 'inbox',
        title: items.length ? '当前筛选下没有反馈' : '还没有收到问题反馈',
        description: '用户从活动平台页头提交反馈后，会按时间倒序显示在这里。',
      }));
      return;
    }
    list.replaceChildren(...shown.map(card));
  }

  function card(item) {
    const resolve = checkbox({
      name: `feedback-resolved-${item.id}`,
      label: '已解决',
      checked: item.resolved,
      onChange: (checked) => setResolved(item, checked, resolve),
    });
    resolve.control.setAttribute(
      'aria-label',
      `${item.resolved ? '恢复为待解决' : '标记为已解决'}：${item.feedbackId || item.id}`,
    );
    return h('article', { class: 'feedback-item', data: { resolved: String(item.resolved) } },
      h('header', { class: 'feedback-item__head' },
        badge(item.category, { tone: TONES[item.category] || 'neutral' }),
        badge(item.status, {
          tone: item.resolved ? 'success' : 'warning',
          iconName: item.resolved ? 'check' : 'clock',
        }),
        h('span', { class: 'feedback-item__submitter', text: item.submitter || '访客' }),
        h('time', {
          class: 't-caption',
          text: item.submittedAt ? fmt.fullDateTime(item.submittedAt) : '时间未记录',
          attrs: item.submittedAt ? { datetime: item.submittedAt } : {},
        })),
      h('p', { class: 'feedback-item__content', text: item.content }),
      item.activityName
        ? h('div', { class: 'feedback-item__activity' },
          h('span', { class: 'row-2' }, icon('calendar', 'ico ico--sm'), h('span', { text: item.activityName })),
          item.ownerMailStatus
            ? badge(`负责人邮件：${item.ownerMailStatus}`, {
              tone: item.ownerMailStatus === '已发送' ? 'success' : item.ownerMailStatus === '部分发送' ? 'warning' : 'error',
            })
            : null)
        : null,
      h('footer', { class: 'feedback-item__foot' },
        h('div', { class: 'feedback-item__meta' },
          h('span', { text: item.source || '活动平台' }),
          h('span', { class: 't-faint', text: item.feedbackId || item.id }),
          item.ownerMailAt
            ? h('span', { text: `负责人邮件时间：${fmt.fullDateTime(item.ownerMailAt)}` })
            : null,
          item.resolved
            ? h('span', { text: `${item.resolvedBy || '管理员'} · ${item.resolvedAt ? fmt.fullDateTime(item.resolvedAt) : '已归类为已解决'}` })
            : null),
        resolve));
  }

  async function setResolved(item, resolved, controlNode) {
    const input = controlNode.control;
    input.disabled = true;
    try {
      await request(`/api/console/feedback/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: { resolved },
      });
      notify.success(resolved ? '已归类为已解决' : '已恢复为待解决');
      await view.reload();
    } catch (error) {
      input.checked = !resolved;
      controlNode.dataset.checked = String(!resolved);
      reportError(error, resolved ? '未能标记为已解决' : '未能恢复为待解决');
    } finally {
      input.disabled = false;
    }
  }

  const view = asyncRegion({
    errorTitle: '问题反馈暂时无法加载',
    load: () => request('/api/console/feedback'),
    render: (data) => {
      items = data.items || [];
      truncated = data.truncated === true;
      draw();
      return h('div', { class: 'stack-6' },
        data.ready ? null : notice('「问题反馈表」尚未配置。请先完成数据表迁移，用户才能提交反馈。', {
          tone: 'warning',
          title: '数据表尚未就绪',
        }),
        metrics,
        h('section', { class: 'feedback-inbox' },
          h('header', { class: 'feedback-inbox__head' },
            h('div', { class: 'stack-1' },
              h('h2', { class: 't-h3', text: '用户反馈' }),
              h('p', { class: 't-caption', text: '问题修正后勾选“已解决”，反馈会归入已解决列表。' })),
            h('span', { class: 'spacer' }),
            button({ label: '刷新', variant: 'secondary', iconName: 'refresh', iconMotion: 'spin', onClick: () => view.reload() })),
          h('div', { class: 'feedback-inbox__toolbar' },
            h('div', { class: 'feedback-filter-groups' }, tabs, statusTabs),
            summary),
          list,
          empty));
    },
  });

  return {
    title: '问题反馈',
    crumb: '问题反馈',
    node: h('div', { class: 'view wspad wspad--wide stack-6' },
      pageHead({
        title: '问题反馈',
        description: '集中查看活动平台用户提交的活动、物资、内建、宣传及其他问题。',
      }),
      view),
  };
}
