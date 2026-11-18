import { h } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { badge, button, emptyState, metric, metricRow, notice, pageHead, segmented } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';
import { asyncRegion } from '../lib.js';

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
    const shown = items.filter((item) => filter === '全部' || item.category === filter);
    totalMetric.setValue(items.length);
    for (const category of CATEGORIES) {
      categoryMetrics.get(category).setValue(items.filter((item) => item.category === category).length);
    }
    summary.textContent = `当前显示 ${shown.length} 条${truncated ? ' · 列表已达到读取上限' : ''}`;
    list.hidden = shown.length === 0;
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.replaceChildren(emptyState({
        iconName: 'inbox',
        title: filter === '全部' ? '还没有收到问题反馈' : `暂无「${filter}」分类反馈`,
        description: '用户从活动平台页头提交反馈后，会按时间倒序显示在这里。',
      }));
      return;
    }
    list.replaceChildren(...shown.map(card));
  }

  function card(item) {
    return h('article', { class: 'feedback-item' },
      h('header', { class: 'feedback-item__head' },
        badge(item.category, { tone: TONES[item.category] || 'neutral' }),
        h('span', { class: 'feedback-item__submitter', text: item.submitter || '访客' }),
        h('time', {
          class: 't-caption',
          text: item.submittedAt ? fmt.fullDateTime(item.submittedAt) : '时间未记录',
          attrs: item.submittedAt ? { datetime: item.submittedAt } : {},
        })),
      h('p', { class: 'feedback-item__content', text: item.content }),
      h('footer', { class: 'feedback-item__foot' },
        h('span', { text: item.source || '活动平台' }),
        h('span', { class: 't-faint', text: item.id })));
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
              h('p', { class: 't-caption', text: '按提交时间倒序展示；点击分类可快速筛选。' })),
            h('span', { class: 'spacer' }),
            button({ label: '刷新', variant: 'secondary', iconName: 'refresh', iconMotion: 'spin', onClick: () => view.reload() })),
          h('div', { class: 'feedback-inbox__toolbar' }, tabs, summary),
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
