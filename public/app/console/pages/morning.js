/* ==========================================================================
   console/pages/morning.js — “早安晚安” member-card review.
   Registration creates a pending card; this queue is the only path that
   publishes a card to the public plaza.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, reloadAction } from '../lib.js';
import { communityModuleNav } from '../community-nav.js';
import {
  pageHead, metric, metricRow, badge, button, field, notice,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor,
  definitionList, copyableCode, runWithLoading,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const CARD_STATUS = Object.freeze({
  PENDING: '待审核',
  PUBLISHED: '已发布',
  RETURNED: '需修改',
  REJECTED: '已拒绝',
  WITHDRAWN: '已退出',
});

const REVIEW_STATUS = new Set(Object.values(CARD_STATUS));
const COMMENT_REPORT_STATUS = Object.freeze({
  PENDING: '待处理',
  RESOLVED: '已处理',
  DISMISSED: '已驳回',
});

const REVIEW_APPEARANCE = {
  approve: { label: '通过并发布', variant: 'success' },
  return: { label: '退回修改', variant: 'secondary' },
  reject: { label: '拒绝报名', variant: 'danger' },
};

function tagBadges(tags = []) {
  const visible = tags.slice(0, 5);
  return h(
    'div',
    { class: 'row-2 row-wrap' },
    ...visible.map((tag) => badge(tag, { tone: 'neutral' })),
    tags.length > visible.length ? badge(`+${tags.length - visible.length}`, { tone: 'neutral' }) : null,
  );
}

function syncReviewButton(buttonNode, decision) {
  const appearance = REVIEW_APPEARANCE[decision] || REVIEW_APPEARANCE.approve;
  buttonNode.classList.remove('btn--primary', 'btn--secondary', 'btn--ghost', 'btn--danger', 'btn--success');
  buttonNode.classList.add(`btn--${appearance.variant}`);
  const label = buttonNode.querySelector('span');
  if (label) label.textContent = appearance.label;
}

function openMorningReviewDrawer(cardId, { onDone } = {}) {
  const body = h('div', { class: 'stack-5' }, skeletonRows(4));
  const drawer = openDrawer({
    placement: 'center',
    eyebrow: '早安晚安 · 报名审核',
    title: '审核报名名片',
    description: cardId,
    width: 580,
    body: [body],
    footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
  });

  function renderCard(card) {
    const pending = card.status === CARD_STATUS.PENDING;
    const identity = h(
      'div',
      { class: 'stack-2' },
      h('p', { class: 't-label', text: '报名与核验信息' }),
      definitionList([
        ['名片编号', copyableCode(card.id)],
        ['真实姓名', card.realName || '—'],
        ['学号', card.studentId || '—'],
        ['性别', card.gender || '—'],
        ['校区', card.campus || '—'],
        ['通知邮箱', card.allowEmail ? '允许评论邮件提醒' : '已关闭评论邮件提醒'],
      ]),
    );
    const publicProjection = h(
      'div',
      { class: 'stack-3' },
      h('div', { class: 'row-3 row-wrap' }, badge(card.campus || '未填校区', { tone: 'accent' }), badge(card.allowEmail ? '邮件提醒已开启' : '仅站内可见', { tone: card.allowEmail ? 'success' : 'neutral' })),
      h(
        'div',
        { class: 'stack-2' },
        h('p', { class: 't-label', text: '公开昵称' }),
        h('p', { class: 't-h3', text: card.nickname || '—' }),
      ),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '公开兴趣标签' }), tagBadges(card.interestTags)),
      h(
        'div',
        { class: 'stack-2' },
        h('p', { class: 't-label', text: '公开备注' }),
        h('div', { class: 'content-preview t-secondary', text: card.note || '未填写备注' }),
      ),
    );

    if (!pending) {
      drawer.setBody(
        h('div', { class: 'row-3 row-wrap' }, statusFor(card.status), badge(`提交于 ${fmt.fullDateTime(card.submittedAt)}`, { tone: 'neutral' })),
        identity,
        h('hr', { class: 'divider' }),
        publicProjection,
        h('hr', { class: 'divider' }),
        definitionList([
          ['审核人', card.reviewedBy || '—'],
          ['审核时间', card.reviewedAt ? fmt.fullDateTime(card.reviewedAt) : '—'],
          ['审核意见', card.reviewNote || '—'],
        ]),
        notice('只有「待审核」名片可以提交审核结果。已处理记录保留在这里供复核。', { tone: 'info' }),
      );
      drawer.setFooter([h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })]);
      return;
    }

    let decision = 'approve';
    const noteField = field({
      label: '审核意见',
      name: 'morningReviewNote',
      multiline: true,
      rows: 3,
      maxlength: 300,
      placeholder: '退回或拒绝时必填，写清需要修改的内容或拒绝原因。',
    });
    const decisionControl = segmented({
      items: [
        { value: 'approve', label: '通过并发布' },
        { value: 'return', label: '退回修改' },
        { value: 'reject', label: '拒绝报名' },
      ],
      value: decision,
      ariaLabel: '审核结果',
      role: 'radiogroup',
      onChange: (value) => {
        decision = value;
        decisionControl.setValue(value);
        noteField.setError(null);
        syncReviewButton(submitButton, decision);
      },
    });
    const submitButton = button({
      label: REVIEW_APPEARANCE[decision].label,
      variant: REVIEW_APPEARANCE[decision].variant,
      iconName: 'check',
      onClick: () => submit(),
    });

    async function submit() {
      noteField.setError(null);
      const note = noteField.control.value.trim();
      if (decision !== 'approve' && !note) {
        noteField.setError(decision === 'reject' ? '拒绝报名必须填写原因' : '退回修改必须填写审核意见');
        shake(noteField);
        return;
      }
      if (decision === 'reject') {
        const confirmed = await confirmAction({
          title: '拒绝这张报名名片？',
          description: '拒绝后成员会看到审核意见，可以修改后重新提交。',
          confirmLabel: '拒绝报名',
          tone: 'danger',
          details: [`名片编号：${card.id}`, `拒绝原因：${note}`],
        });
        if (!confirmed) return;
      }
      try {
        const payload = await runWithLoading(submitButton, () => consoleApi.morning.review(card.id, { decision, note }));
        notify.success(
          decision === 'approve' ? '名片已通过并发布' : decision === 'reject' ? '报名已拒绝' : '名片已退回修改',
          payload.message,
        );
        await onDone?.({ decision, id: card.id });

        let nextCard = null;
        try {
          const list = await consoleApi.morning.cards({ status: CARD_STATUS.PENDING });
          nextCard = (list.cards || []).find((row) => row.id !== card.id) || null;
        } catch {
          nextCard = null;
        }
        const doneLabel = decision === 'approve' ? '已通过并发布' : decision === 'reject' ? '已拒绝报名' : '已退回修改';
        drawer.setBody(
          notice(
            `${doneLabel}：${card.nickname || card.id}。${nextCard ? '还有待审核名片，可以直接继续。' : '没有其他待审核名片了。'}`,
            { tone: 'success', title: '审核完成' },
          ),
        );
        drawer.setFooter(
          nextCard
            ? [
                h('span', { class: 'spacer' }),
                button({
                  label: '审核下一条',
                  variant: 'primary',
                  iconName: 'arrowRight',
                  onClick: () => {
                    drawer.close();
                    openMorningReviewDrawer(nextCard.id, { onDone });
                  },
                }),
              ]
            : [h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() })],
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 400) {
          noteField.setError(error.message);
          shake(noteField);
          return;
        }
        reportError(error, '审核未完成');
        if (error instanceof ApiError && error.isConflict) await onDone?.({ decision, id: card.id });
      }
    }

    drawer.setBody(
      h('div', { class: 'row-3 row-wrap' }, statusFor(card.status), badge(`提交于 ${fmt.fullDateTime(card.submittedAt)}`, { tone: 'neutral' })),
      identity,
      h('hr', { class: 'divider' }),
      publicProjection,
      h('hr', { class: 'divider' }),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '审核结果' }), decisionControl),
      noteField,
      notice('通过后会立即进入同行广场；退回或拒绝后，成员修改并重新提交会再次进入待审核。', { tone: 'warning' }),
    );
    drawer.setFooter([
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ]);
  }

  async function load() {
    try {
      const payload = await consoleApi.morning.card(cardId);
      clear(body);
      renderCard(payload.card);
    } catch (error) {
      clear(body);
      body.append(notice(`报名名片无法加载：${error.message || '请稍后重试'}`, { tone: 'warning' }));
    }
  }

  void load();
  return drawer;
}

function openMorningReportDrawer(report, { onDone } = {}) {
  const pending = report.status === COMMENT_REPORT_STATUS.PENDING;
  const noteField = field({
    label: '处理意见',
    name: 'morningReportNote',
    multiline: true,
    rows: 4,
    maxlength: 500,
    required: true,
    placeholder: '说明确认举报或驳回举报的依据。',
  });
  const handleButton = button({
    label: '确认举报并隐藏评论',
    variant: 'danger',
    iconName: 'shield',
    onClick: () => submit('handle'),
  });
  const dismissButton = button({
    label: '驳回举报并恢复评论',
    variant: 'secondary',
    iconName: 'refresh',
    onClick: () => submit('dismiss'),
  });
  const drawer = openDrawer({
    placement: 'center',
    eyebrow: '早安晚安 · 举报处理',
    title: `举报 ${report.id}`,
    description: report.cardNickname ? `${report.cardNickname} · ${report.cardId}` : report.cardId,
    width: 580,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(report.status), badge(`举报于 ${fmt.fullDateTime(report.submittedAt)}`, { tone: 'neutral' })),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '被举报评论' }), h('div', { class: 'content-preview t-secondary', text: report.content || '（评论内容不可用）' })),
      definitionList([
        ['评论人账号', report.reportedAccountId || '—'],
        ['举报人账号', report.reporterAccountId || '—'],
        ['评论当前状态', report.commentStatus || '—'],
        ['举报原因', report.reason || '—'],
      ]),
      pending ? noteField : h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '处理意见' }), h('div', { class: 'content-preview t-secondary', text: report.resolutionNote || '—' })),
      pending
        ? notice('确认举报后评论保持隐藏；驳回后会立即恢复到公开评论列表。', { tone: 'warning' })
        : definitionList([
            ['处理人', report.handledBy || '—'],
            ['处理时间', report.handledAt ? fmt.fullDateTime(report.handledAt) : '—'],
          ]),
    ],
    footer: pending
      ? [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), dismissButton, handleButton]
      : [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
  });

  async function submit(action) {
    noteField.setError(null);
    const note = noteField.control.value.trim();
    if (!note) {
      noteField.setError('请填写处理意见');
      shake(noteField);
      return;
    }
    const confirmed = await confirmAction({
      title: action === 'handle' ? '确认举报并隐藏评论？' : '驳回举报并恢复评论？',
      description: action === 'handle'
        ? '评论将继续保持隐藏，不会出现在公开评论列表中。'
        : '评论将恢复到公开评论列表，举报记录保留为已驳回。',
      confirmLabel: action === 'handle' ? '确认举报' : '驳回举报',
      tone: action === 'handle' ? 'danger' : 'neutral',
      details: [`处理意见：${note}`],
    });
    if (!confirmed) return;
    try {
      const payload = await runWithLoading(action === 'handle' ? handleButton : dismissButton, () =>
        consoleApi.morning.decideReport(report.id, action, { note }),
      );
      notify.success(action === 'handle' ? '举报已确认' : '举报已驳回', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        noteField.setError(error.message);
        shake(noteField);
        return;
      }
      reportError(error, '举报处理未完成');
    }
  }
}

export default async function morningAdminPage(context, shell) {
  let status = context.query.get('status') || CARD_STATUS.PENDING;
  if (!REVIEW_STATUS.has(status)) status = CARD_STATUS.PENDING;
  let reportStatus = context.query.get('reportStatus') || COMMENT_REPORT_STATUS.PENDING;
  if (!new Set([...Object.values(COMMENT_REPORT_STATUS), '全部']).has(reportStatus)) reportStatus = COMMENT_REPORT_STATUS.PENDING;
  let view = context.query.get('view') === 'reports' ? 'reports' : 'review';

  const bodySlot = h('div', { class: 'stack-6' });

  const viewControl = segmented({
    items: [
      { value: 'review', label: '名片审核' },
      { value: 'reports', label: '举报处理' },
    ],
    value: view,
    ariaLabel: '早安晚安管理视图',
    role: 'radiogroup',
    onChange: (value) => {
      view = value;
      viewControl.setValue(value);
      renderPage();
    },
  });

  const tabControl = segmented({
    items: [
      { value: CARD_STATUS.PENDING, label: '待审核' },
      { value: CARD_STATUS.PUBLISHED, label: '已发布' },
      { value: CARD_STATUS.RETURNED, label: '需修改' },
      { value: CARD_STATUS.REJECTED, label: '已拒绝' },
      { value: CARD_STATUS.WITHDRAWN, label: '已退出' },
    ],
    value: status,
    ariaLabel: '早安晚安审核视图',
    role: 'radiogroup',
    onChange: (value) => {
      status = value;
      tabControl.setValue(value);
      region.reload();
    },
  });

  const region = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(5), skeletonRows(6)),
    errorTitle: '早安晚安审核队列无法加载',
    load: () => consoleApi.morning.cards({ status }),
    render: (payload, { reload }) => {
      const stats = payload.stats || {};
      const rows = payload.cards || [];
      const selectStatus = (next) => {
        status = next;
        tabControl.setValue(next);
        reload();
      };
      return [
        metricRow(
          [
            metric({ label: '待审核', value: stats.pending || 0, unit: '张', tone: stats.pending ? 'warn' : '', onClick: () => selectStatus(CARD_STATUS.PENDING) }),
            metric({ label: '已发布', value: stats.published || 0, unit: '张', onClick: () => selectStatus(CARD_STATUS.PUBLISHED) }),
            metric({ label: '需修改', value: stats.returned || 0, unit: '张', tone: stats.returned ? 'warn' : '', onClick: () => selectStatus(CARD_STATUS.RETURNED) }),
            metric({ label: '已拒绝', value: stats.rejected || 0, unit: '张', onClick: () => selectStatus(CARD_STATUS.REJECTED) }),
            metric({ label: '已退出', value: stats.exited || 0, unit: '张', onClick: () => selectStatus(CARD_STATUS.WITHDRAWN) }),
          ],
          { columns: 5 },
        ),
        dataTable({
          columns: [
            { key: 'id', label: '名片编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'nickname', label: '昵称', strong: true },
            { key: 'campus', label: '校区', render: (row) => badge(row.campus || '—', { tone: 'accent' }) },
            {
              key: 'interestTags',
              label: '兴趣标签',
              value: (row) => (row.interestTags || []).join('、'),
              render: (row) => tagBadges(row.interestTags),
            },
            { key: 'status', label: '审核状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
            { key: 'reviewedBy', label: '审核人', render: (row) => h('span', { class: 't-caption', text: row.reviewedBy || '—' }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索昵称、名片编号、校区或兴趣标签',
          searchKeys: ['id', 'nickname', 'campus', 'interestTags'],
          countLabel: (count) => `${count} 张${status}名片`,
          empty: emptyState({
            iconName: status === CARD_STATUS.PENDING ? 'inbox' : 'handshake',
            title: status === CARD_STATUS.PENDING ? '没有待审核的报名名片' : `没有${status}名片`,
            description: status === CARD_STATUS.PENDING
              ? '成员提交报名后会进入这里；通过前不会出现在公开广场。'
              : '可以切换上方状态查看其他审核记录。',
          }),
          onRowClick: (row) =>
            openMorningReviewDrawer(row.id, {
              onDone: async () => {
                await reload();
                shell.refreshTodos();
              },
            }),
          buildRowAction: (row) =>
            button({
              label: row.status === CARD_STATUS.PENDING ? '审核' : '查看',
              variant: row.status === CARD_STATUS.PENDING ? 'primary' : 'secondary',
              size: 'sm',
              iconName: row.status === CARD_STATUS.PENDING ? 'eye' : 'search',
              onClick: () =>
                openMorningReviewDrawer(row.id, {
                  onDone: async () => {
                    await reload();
                    shell.refreshTodos();
                  },
                }),
            }),
        }),
        notice('实名信息只用于管理员核验，不会进入公开广场。只有审核通过的公开昵称、校区、兴趣标签和备注会对外展示。', {
          tone: 'info',
          iconName: 'shield',
        }),
      ];
    },
  });

  const reportsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '举报处理队列无法加载',
    load: () => consoleApi.morning.reports({ status: reportStatus }),
    render: (payload, { reload }) => {
      const stats = payload.stats || {};
      const rows = payload.reports || [];
      const selectStatus = (next) => {
        reportStatus = next;
        reportsStatusControl.setValue(next);
        reload();
      };
      return [
        metricRow(
          [
            metric({ label: '举报总数', value: stats.total || 0, unit: '条', animate: false }),
            metric({ label: '待处理', value: stats.pending || 0, unit: '条', tone: stats.pending ? 'warn' : '', onClick: () => selectStatus(COMMENT_REPORT_STATUS.PENDING) }),
            metric({ label: '已处理', value: stats.handled || 0, unit: '条', onClick: () => selectStatus(COMMENT_REPORT_STATUS.RESOLVED) }),
            metric({ label: '已驳回', value: stats.dismissed || 0, unit: '条', onClick: () => selectStatus(COMMENT_REPORT_STATUS.DISMISSED) }),
          ],
          { columns: 4 },
        ),
        dataTable({
          columns: [
            { key: 'id', label: '评论编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'cardNickname', label: '名片', strong: true, render: (row) => h('span', { text: row.cardNickname || row.cardId }) },
            { key: 'content', label: '评论内容', render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'reason', label: '举报原因', render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.reason }) },
            { key: 'reportedAccountId', label: '评论人账号', render: (row) => h('span', { class: 't-caption', text: row.reportedAccountId || '—' }) },
            { key: 'status', label: '处理状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '举报时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
            { key: 'handledBy', label: '处理人', render: (row) => h('span', { class: 't-caption', text: row.handledBy || '—' }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索评论、举报原因或账号',
          searchKeys: ['id', 'cardNickname', 'cardId', 'content', 'reason', 'reportedAccountId', 'reporterAccountId'],
          actions: [reportsStatusControl],
          countLabel: (count) => `${count} 条${reportStatus}`,
          empty: emptyState({
            iconName: reportStatus === COMMENT_REPORT_STATUS.PENDING ? 'shield' : 'inbox',
            title: reportStatus === COMMENT_REPORT_STATUS.PENDING ? '没有待处理的举报' : `没有${reportStatus}举报`,
            description: reportStatus === COMMENT_REPORT_STATUS.PENDING
              ? '名片本人举报评论后，记录会进入这里等待处理。'
              : '可以切换上方状态查看其他举报记录。',
          }),
          onRowClick: (row) => openMorningReportDrawer(row, { onDone: async () => { await reload(); shell.refreshTodos(); } }),
          buildRowAction: (row) => button({
            label: row.status === COMMENT_REPORT_STATUS.PENDING ? '处理' : '查看',
            variant: row.status === COMMENT_REPORT_STATUS.PENDING ? 'primary' : 'secondary',
            size: 'sm',
            iconName: row.status === COMMENT_REPORT_STATUS.PENDING ? 'shield' : 'eye',
            onClick: () => openMorningReportDrawer(row, { onDone: async () => { await reload(); shell.refreshTodos(); } }),
          }),
        }),
        notice('确认举报后评论保持隐藏；驳回举报后评论恢复公开。两种处理都会保留处理人、时间和意见。', { tone: 'info', iconName: 'shield' }),
      ];
    },
  });

  const reportsStatusControl = segmented({
    items: [
      { value: COMMENT_REPORT_STATUS.PENDING, label: '待处理' },
      { value: COMMENT_REPORT_STATUS.RESOLVED, label: '已处理' },
      { value: COMMENT_REPORT_STATUS.DISMISSED, label: '已驳回' },
      { value: '全部', label: '全部' },
    ],
    value: reportStatus,
    ariaLabel: '举报处理状态',
    role: 'radiogroup',
    onChange: (value) => {
      reportStatus = value;
      reportsStatusControl.setValue(value);
      reportsRegion.reload();
    },
  });

  function renderPage() {
    clear(bodySlot);
    const current = view === 'reports' ? reportsRegion : region;
    const statusControl = view === 'reports' ? reportsStatusControl : tabControl;
    current.ensureLoaded();
    bodySlot.append(
      h('div', { class: 'row-3 row-wrap' }, viewControl, h('span', { class: 'spacer' }), reloadAction(current, '刷新')),
      h('div', { class: 'row-3 row-wrap' }, statusControl),
      current,
    );
    requestAnimationFrame(() => {
      viewControl.reposition?.();
      statusControl.reposition?.();
    });
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '温暖连接 · 早安晚安',
      title: '早安晚安管理',
      description: '名片审核与评论举报处理并列管理；审核通过后名片才会发布到同行广场。',
      meta: [badge('人工审核闸门', { tone: 'warning', iconName: 'shield' })],
      actions: [button({ label: '查看公众广场', variant: 'secondary', iconAfter: 'external', href: '/morning/plaza', data: { native: 'true' } })],
    }),
    communityModuleNav('morning'),
    bodySlot,
  );

  renderPage();
  return { title: '早安晚安管理', crumb: '早安晚安管理', node };
}
