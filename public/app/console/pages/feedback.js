/* ==========================================================================
   console/pages/feedback.js
   Task: platform problem feedback (N1 平台问题反馈) — processing console.
   Summary metrics + issue list + detail drawer with the frozen state machine
   (待处理 → 处理中 → 已回复 → 已关闭). Closed is terminal and rejects writes.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { openDrawer, requestText } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction, summaryMetric } from '../lib.js';
import { pageHead, badge, button, field, notice, emptyState, runWithLoading, definitionList, metricRow, segmented } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';

const CATEGORIES = ['注册', '登录', '资料', '报名', '时长', 'Bug', '其他'];
const STATUS_OPTIONS = [{ value: '', label: '全部' }, { value: '待处理', label: '待处理' }, { value: '处理中', label: '处理中' }, { value: '已回复', label: '已回复' }, { value: '已关闭', label: '已关闭' }];

function feedbackTone(status) {
  if (status === '待处理') return 'warning';
  if (status === '处理中') return 'info';
  if (status === '已回复') return 'success';
  return 'neutral';
}

export default async function feedbackPage() {
  let statusFilter = '';

  const summaryRegion = asyncRegion({
    errorTitle: '问题概览加载失败',
    load: () => consoleApi.feedback.summary(),
    render: renderSummary,
  });
  const listRegion = asyncRegion({
    errorTitle: '问题列表加载失败',
    load: () => consoleApi.feedback.list({ status: statusFilter }),
    render: data => renderList(data.issues || []),
  });

  const reloadAll = () => { summaryRegion.reload(); listRegion.reload(); };

  function renderSummary(data) {
    const counts = data.counts || {};
    const metrics = [
      summaryMetric({ label: '待处理', value: counts['待处理'] ?? 0, tone: 'warning' }),
      summaryMetric({ label: '处理中', value: counts['处理中'] ?? 0, tone: 'info' }),
      summaryMetric({ label: '已回复', value: counts['已回复'] ?? 0, tone: 'success' }),
      summaryMetric({ label: '已关闭', value: counts['已关闭'] ?? 0, tone: 'neutral' }),
      summaryMetric({ label: '总计', value: data.total ?? 0 }),
    ];
    return metricRow(metrics);
  }

  function renderList(issues) {
    return dataTable({
      searchPlaceholder: '搜索描述、提交人或分类',
      searchKeys: ['description', 'submitter', 'category', 'handler'],
      columns: [
        { key: 'category', label: '分类' },
        { key: 'description', label: '问题描述', strong: true, render: row => h('span', { class: 't-clamp-1', text: row.description }) },
        { key: 'source', label: '来源' },
        { key: 'domain', label: '业务域' },
        { key: 'status', label: '状态', sortable: false, render: row => badge(row.status, { tone: feedbackTone(row.status) }) },
        { key: 'submittedAt', label: '提交时间' },
        { key: 'handler', label: '处理人', render: row => h('span', { text: row.handler || '—' }) },
      ],
      rows: issues,
      getKey: row => row.id,
      empty: emptyState({ iconName: 'inbox', title: '还没有问题反馈', description: '公众端或管理端提交的问题会出现在这里。' }),
      onRowClick: row => openIssueDrawer(row),
    });
  }

  function openIssueDrawer(initial) {
    const drawer = openDrawer({
      eyebrow: '问题反馈处理', title: `${initial.code} · ${initial.category}`, width: 520,
      body: h('div', { class: 'stack-4' }),
      footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
    });

    function render(issue) {
      drawer.setBody(
        h('div', { class: 'stack-4' },
          h('div', { class: 'row-2 row-wrap' }, badge(issue.status, { tone: feedbackTone(issue.status) }), badge(issue.domain || '综事中心', { tone: 'neutral', iconName: 'building' })),
          definitionList([
            ['分类', issue.category],
            ['提交人', issue.submitter],
            ['账号', issue.submitterAccount || '—'],
            ['来源', issue.source],
            ['联系方式', issue.contact || '—'],
            ['提交时间', issue.submittedAt],
            ['问题描述', issue.description],
            issue.screenshot ? ['截图', h('a', { class: 't-link', href: issue.screenshot, attrs: { target: '_blank', rel: 'noopener' }, text: '查看截图' })] : null,
            issue.handler ? ['处理人', issue.handler] : null,
            issue.startedAt ? ['开始处理时间', issue.startedAt] : null,
            issue.repliedAt ? ['回复时间', issue.repliedAt] : null,
            issue.closedAt ? ['关闭时间', issue.closedAt] : null,
            issue.note ? ['处理说明', issue.note] : null,
          ]),
          actions(issue),
        ),
      );
    }

    function actions(issue) {
      const buttons = [];
      if (issue.status === '待处理') {
        buttons.push(button({ label: '开始处理', variant: 'primary', iconName: 'play', onClick: () => transition(issue, 'start') }));
      }
      if (issue.status === '处理中') {
        buttons.push(button({ label: '回复', variant: 'primary', iconName: 'mail', onClick: () => reply(issue) }));
      }
      if (issue.status !== '已关闭') {
        buttons.push(button({ label: '关闭', variant: 'danger', iconName: 'close', onClick: () => close(issue) }));
      }
      if (!buttons.length) return notice('该问题已关闭，不可再修改。', { tone: 'neutral', title: '已归档' });
      return h('div', { class: 'stack-2' },
        h('p', { class: 'field__label', text: '处理操作' }),
        h('div', { class: 'row-3 row-wrap' }, ...buttons));
    }

    async function transition(issue, action, note = '') {
      try {
        const payload = await consoleApi.feedback.transition(issue.id, { action, note });
        notify.success('已更新', payload.message);
        render(payload.issue);
        reloadAll();
      } catch (error) {
        reportError(error, '处理未完成');
      }
    }

    async function reply(issue) {
      const note = await requestText({ title: '填写回复说明', label: '回复说明', required: true });
      if (!note) return;
      await transition(issue, 'reply', note);
    }

    async function close(issue) {
      const note = await requestText({ title: '关闭问题（可选说明）', label: '关闭说明', required: false });
      if (note === null) return;
      await transition(issue, 'close', note);
    }

    render(initial);
  }

  async function openSubmitDrawer() {
    const categoryField = field({ label: '问题分类', name: 'category', required: true, options: [{ value: '', label: '请选择分类' }].concat(CATEGORIES.map(c => ({ value: c, label: c }))) });
    const descriptionField = field({ label: '问题描述', name: 'description', required: true, multiline: true, rows: 5 });
    const contactField = field({ label: '联系方式', name: 'contact', placeholder: '用于回复，可留空' });
    const errorSlot = h('div', { role: 'alert' });
    const submitButton = button({ label: '提交问题', variant: 'primary', iconName: 'check', onClick: () => submit() });
    const drawer = openDrawer({
      eyebrow: '平台问题反馈', title: '登记问题', description: '管理端代填的问题会标记来源为「管理端」。',
      body: [categoryField, descriptionField, contactField, errorSlot],
      footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
    });

    async function submit() {
      clear(errorSlot);
      for (const f of [categoryField, descriptionField]) f.setError(null);
      if (!categoryField.control.value) { categoryField.setError('请选择分类'); categoryField.control.focus(); return; }
      if (!descriptionField.control.value.trim()) { descriptionField.setError('请填写问题描述'); descriptionField.control.focus(); return; }
      try {
        const payload = await runWithLoading(submitButton, () => consoleApi.feedback.submit({
          category: categoryField.control.value,
          description: descriptionField.control.value.trim(),
          contact: contactField.control.value.trim(),
        }));
        notify.success('问题已登记', payload.message);
        drawer.close();
        reloadAll();
      } catch (error) {
        errorSlot.replaceChildren(notice(error.message || '提交失败，请重试。', { tone: 'error' }));
        if (!(error instanceof ApiError && error.status === 400)) reportError(error, '提交失败');
      }
    }
  }

  const node = h('div', { class: 'view wspad wspad--wide' },
    pageHead({
      label: '平台运维', title: '问题反馈', description: '处理公众端与管理端提交的平台问题，状态机为 待处理 → 处理中 → 已回复 → 已关闭。',
      actions: [button({ label: '登记问题', variant: 'primary', iconName: 'plus', onClick: openSubmitDrawer })],
    }),
    region({ label: '概览', title: '处理进度', actions: [reloadAction(summaryRegion)], body: summaryRegion }),
    region({
      label: '问题列表', title: '全部问题',
      actions: [
        segmented({ items: STATUS_OPTIONS, value: statusFilter, role: 'radiogroup', onChange: value => { statusFilter = value; listRegion.reload(); } }),
        reloadAction(listRegion),
      ],
      body: listRegion,
    }),
  );

  // 通知中心跳转携带 issue=<id>，自动打开对应问题详情。
  const issueId = new URLSearchParams(location.search).get('issue');
  if (issueId) {
    try {
      const payload = await consoleApi.feedback.get(issueId);
      openIssueDrawer(payload.issue);
    } catch { /* 打不开就静默落在列表页。 */ }
  }

  return { title: '问题反馈', crumb: '问题反馈', node };
}
