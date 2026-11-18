import { h, icon } from '../../core/dom.js';
import { request } from '../../core/api.js';
import { badge, button, checkbox, emptyState, field, metric, metricRow, notice, pageHead, runWithLoading, segmented } from '../../ui/primitives.js';
import * as fmt from '../../core/format.js';
import { asyncRegion } from '../lib.js';
import { notify, reportError } from '../../core/toast.js';
import { openDrawer } from '../../ui/overlay.js';

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
  let statusFilter = '待解决';
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
      list.replaceChildren();
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
      onChange: (checked) => checked
        ? openResolution(item, resolve)
        : reopenFeedback(item, resolve),
    });
    resolve.control.setAttribute(
      'aria-label',
      item.resolved ? '恢复为待解决' : '填写解决方案并标记为已解决',
    );
    return h('article', { class: 'feedback-item', data: { resolved: String(item.resolved) } },
      h('header', { class: 'feedback-item__head' },
        badge(item.category, { tone: TONES[item.category] || 'neutral' }),
        badge(item.status, {
          tone: item.resolved ? 'success' : 'warning',
          iconName: item.resolved ? 'check' : 'clock',
        }),
        h('time', {
          class: 't-caption',
          text: item.submittedAt ? fmt.fullDateTime(item.submittedAt) : '时间未记录',
          attrs: item.submittedAt ? { datetime: item.submittedAt } : {},
        })),
      h('p', { class: 'feedback-item__content', text: item.content }),
      item.activityName
        ? h('div', { class: 'feedback-item__activity' },
          h('span', { class: 'row-2' }, icon('calendar', 'ico ico--sm'), h('span', { text: item.activityName })),
          item.ownerMailStatus && item.ownerMailStatus !== '已发送'
            ? badge('负责人通知未完成', { tone: 'error' })
            : null)
        : null,
      item.resolved
        ? h('section', { class: 'feedback-item__solution' },
          h('p', { class: 't-label', text: '解决方案' }),
          h('p', { text: item.solution || '未填写解决方案' }),
          item.resolutionMailStatus === '发送失败'
            ? badge('处理结果邮件未送达', { tone: 'error' })
            : null)
        : null,
      h('footer', { class: 'feedback-item__foot' },
        h('span', {
          class: 't-caption',
          text: item.resolved
            ? item.resolutionMailStatus === '发送失败'
              ? '处理结果邮件未送达'
              : '解决方案已发送给反馈人'
            : '问题修正后，填写解决方案并标记为已解决',
        }),
        resolve));
  }

  function applyResolution(item, result) {
    Object.assign(item, {
      resolved: result.item.resolved,
      status: result.item.status,
      resolvedBy: result.item.resolvedBy || '',
      resolvedAt: result.item.resolvedAt || '',
      solution: result.item.solution || '',
      resolutionMailStatus: result.item.resolutionMailStatus || '',
    });
  }

  function redrawPreservingScroll() {
    const scroller = document.getElementById('main');
    const top = scroller?.scrollTop || 0;
    draw();
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = top;
    });
  }

  function openResolution(item, controlNode) {
    let committed = false;
    const solution = field({
      label: '解决方案',
      name: `feedback-solution-${item.id}`,
      multiline: true,
      rows: 6,
      required: true,
      maxlength: 500,
      placeholder: '说明问题原因、已采取的措施和处理结果',
      hint: '保存后会以邮件形式发送给反馈人，最多 500 字。',
    });
    const formError = h('div', { aria: { live: 'polite' } });
    let drawer;
    const save = button({
      label: '保存并发送结果',
      variant: 'primary',
      iconName: 'send',
      onClick: () => runWithLoading(save, async () => {
        const text = solution.control.value.trim();
        solution.setError(text ? '' : '请填写解决方案。');
        if (!text) {
          solution.control.focus();
          return;
        }
        try {
          const result = await request(`/api/console/feedback/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            body: { resolved: true, solution: text },
          });
          applyResolution(item, result);
          committed = true;
          drawer.close();
          notify[result.notification?.ok ? 'success' : 'warning'](
            result.notification?.ok ? '反馈已解决' : '反馈已解决，结果邮件未送达',
          );
          redrawPreservingScroll();
        } catch (error) {
          formError.replaceChildren(notice(error.message || '解决方案未保存。', {
            tone: 'error',
            title: '保存未完成',
          }));
          reportError(error, '解决方案未保存');
        }
      }),
    });
    drawer = openDrawer({
      eyebrow: '问题反馈处理',
      title: '填写解决方案',
      description: '请确认问题已经修正，再填写反馈人能够理解的解决方案。',
      width: 560,
      body: [
        h('div', { class: 'feedback-item__solution feedback-item__solution--original' },
          h('p', { class: 't-label', text: '反馈内容' }),
          h('p', { text: item.content })),
        solution,
        formError,
      ],
      footer: [
        button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
        h('span', { class: 'spacer' }),
        save,
      ],
      onClose: () => {
        if (!committed) {
          controlNode.control.checked = false;
          controlNode.dataset.checked = 'false';
        }
      },
    });
  }

  async function reopenFeedback(item, controlNode) {
    const input = controlNode.control;
    input.disabled = true;
    try {
      await request(`/api/console/feedback/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: { resolved: false },
      });
      applyResolution(item, {
        item: {
          resolved: false,
          status: '待解决',
          resolvedBy: '',
          resolvedAt: '',
          solution: '',
          resolutionMailStatus: '',
        },
      });
      notify.success('已恢复为待解决');
      redrawPreservingScroll();
    } catch (error) {
      input.checked = true;
      controlNode.dataset.checked = 'true';
      reportError(error, '未能恢复为待解决');
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
              h('p', { class: 't-caption', text: '默认显示待解决反馈；解决时必须填写方案并通知反馈人。' })),
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
