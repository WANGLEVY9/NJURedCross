/* ==========================================================================
   console/pages/community.js — warmth programme safety console.
   The emphasis is consent, review and the manual gate before anything is
   sent. Matching produces candidate counts only, never pairings.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, checkbox, notice,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor, definitionList,
  copyableCode, runWithLoading, timeline, statusIndicator,
} from '../../ui/primitives.js';
import { donutChart } from '../../ui/chart.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const PROGRAM_LABEL = { birthday: '生日祝福', morning: '早安晚安' };
const FREQUENCY_LABEL = { once: '只参加一次', weekly: '按周期接收' };
const SUBMISSION_STATUS_APPROVED = '已通过';

/** Review-queue order: items that still need a human decision come first, closed ones sink. */
const SUBMISSION_REVIEW_ORDER = { 待审核: 0, 等待对方加入: 1, 需修改: 2, 已拒绝: 3 };
function submissionReviewRank(status) {
  return SUBMISSION_REVIEW_ORDER[status] ?? 4;
}

function openInterestDrawer(interest, { onDone }) {
  const drawer = openDrawer({
    eyebrow: `${PROGRAM_LABEL[interest.program] || interest.program} · 参加登记`,
    title: interest.nickname || interest.studentId || '参加登记',
    description: `${FREQUENCY_LABEL[interest.frequency] || interest.frequency} · ${fmt.relative(interest.submittedAt)}`,
    width: 480,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(interest.status), badge(`同意版本 v1`, { tone: 'neutral', iconName: 'shield' })),
      definitionList([
        ['登记编号', copyableCode(interest.id)],
        ['项目', PROGRAM_LABEL[interest.program] || interest.program],
        ['真实姓名', interest.realName || '—'],
        ['显示昵称', interest.nickname || '—'],
        ['学号', interest.studentId || '—'],
        ['联系邮箱', interest.contactEmail || '—'],
        ['院系', interest.department || '—'],
        ['年级', interest.grade || '—'],
        ['性别', interest.gender || '—'],
        ['校区', fmt.text(interest.campus)],
        interest.birthdayMonthDay ? ['生日（月-日）', interest.birthdayMonthDay] : null,
        interest.memberCode ? ['身份码', interest.memberCode] : null,
        interest.frequency ? ['接收频率', FREQUENCY_LABEL[interest.frequency] || interest.frequency] : null,
        ['登记时间', fmt.fullDateTime(interest.submittedAt)],
        interest.handledBy ? ['处理人', `${interest.handledBy} · ${fmt.fullDateTime(interest.handledAt)}`] : null,
      ]),
      interest.note ? h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '参与者备注' }), h('div', { class: 'content-preview t-secondary', text: interest.note })) : null,
      notice('加入即进入候选池，加入当天生效。成员撰写的内容仍需经过人工审核，并由管理员确认批次后才会由平台转达。', { tone: 'info', title: '加入的含义' }),
      notice('登记退出会立即把这个人移出候选池与发送队列，且不可被匹配预览统计。', { tone: 'warning', title: '退出的含义' }),
    ].filter(Boolean),
    footer: [
      button({
        label: '登记退出',
        variant: 'danger',
        size: 'sm',
        iconName: 'close',
        onClick: async () => {
          const confirmed = await confirmAction({
            title: '登记退出这个参加意愿？',
            description: `${interest.nickname} 将被移出「${PROGRAM_LABEL[interest.program]}」的候选池与发送队列。`,
            confirmLabel: '登记退出',
            tone: 'danger',
          });
          if (!confirmed) return;
          try {
            await consoleApi.community.decideInterest(interest.id, 'withdraw');
            notify.success('已登记退出', interest.nickname);
            drawer.close();
            onDone?.();
          } catch (error) {
            reportError(error, '操作未完成');
          }
        },
      }),
      h('span', { class: 'spacer' }),
      button({
        label: '确认参加',
        variant: 'primary',
        size: 'sm',
        iconName: 'check',
        disabled: interest.status === '已确认',
        onClick: async () => {
          try {
            await consoleApi.community.decideInterest(interest.id, 'confirm');
            notify.success('已确认参加', `${interest.nickname} 进入候选池`);
            drawer.close();
            onDone?.();
          } catch (error) {
            reportError(error, '操作未完成');
          }
        },
      }),
    ],
  });
}

function openSubmissionReviewDrawer(submission, { onDone }) {
  let decision = 'approve';
  const actionable = submission.status === '待审核';
  const rejected = submission.status === '已拒绝';
  const noteField = field({ label: '审核意见', name: 'note', multiline: true, rows: 3, maxlength: 500, placeholder: '退回时必须写明原因，例如包含联系方式、语气不当或涉及隐私' });
  const decisionControl = segmented({
    items: [
      { value: 'approve', label: '审核通过' },
      { value: 'return', label: '退回修改' },
      { value: 'reject', label: '直接拒绝' },
    ],
    value: decision,
    ariaLabel: '审核结果',
    onChange: (value) => {
      decision = value;
      decisionControl.setValue(value);
      noteField.setError(null);
      syncSubmitButton();
    },
  });

  const SUBMIT_APPEARANCE = {
    approve: { variant: 'success', label: '通过审核' },
    return: { variant: 'secondary', label: '退回修改' },
    reject: { variant: 'danger', label: '直接拒绝' },
  };
  const submitButton = button({ label: SUBMIT_APPEARANCE[decision].label, variant: SUBMIT_APPEARANCE[decision].variant, iconName: 'check', onClick: () => submit() });

  /** Keeps the footer action aligned with the selected decision (solid green = approve). */
  function syncSubmitButton() {
    const appearance = SUBMIT_APPEARANCE[decision] || SUBMIT_APPEARANCE.approve;
    submitButton.classList.remove('btn--primary', 'btn--secondary', 'btn--ghost', 'btn--danger', 'btn--success');
    submitButton.classList.add(`btn--${appearance.variant}`);
    const labelNode = submitButton.querySelector('span');
    if (labelNode) labelNode.textContent = appearance.label;
  }

  const reopenButton = button({ label: '撤销拒绝并重新审核', variant: 'danger', iconName: 'refresh', onClick: () => reopen() });

  const drawer = openDrawer({
    eyebrow: `${PROGRAM_LABEL[submission.program] || submission.program} · 投稿审核`,
    title: `投稿 ${submission.id}`,
    description: `${submission.tone} · ${fmt.relative(submission.submittedAt)}`,
    width: 500,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(submission.status), badge(submission.actor, { tone: 'neutral', iconName: 'user' })),
      definitionList([
        ['署名昵称', submission.nickname || '—'],
        ['投递方式', submission.delivery || '—'],
        ['目标学号', submission.targetStudentId || '（无）'],
        ['投递条件', submission.deliveryState || '—'],
      ]),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '投稿内容' }), h('div', { class: 'content-preview t-secondary', text: submission.content })),
      actionable ? h('div', { class: 'field' }, h('p', { class: 'field__label', text: '审核结果' }), decisionControl) : null,
      actionable ? noteField : null,
      !actionable ? notice(`当前状态为「${submission.status}」。${rejected ? '如需重新审核，请使用下方的撤销拒绝按钮。' : '该投稿已经完成审核，不能重复提交审核结果。'}`, { tone: rejected ? 'warning' : 'info' }) : null,
      notice('审核通过不会触发匹配或发送。发送仍需管理员在确认批次后逐步执行。', { tone: 'info' }),
    ].filter(Boolean),
    footer: actionable
      ? [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton]
      : rejected
        ? [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), reopenButton]
        : [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
  });

  async function submit() {
    noteField.setError(null);
    const note = noteField.control.value.trim();
    if (decision !== 'approve' && !note) {
      noteField.setError(decision === 'reject' ? '直接拒绝必须填写理由' : '退回投稿必须填写审核意见');
      shake(noteField);
      return;
    }
    if (decision === 'reject') {
      const confirmed = await confirmAction({
        title: '直接拒绝这条投稿？',
        description: '拒绝后成员会立即看到结果。如需重新审核，需要管理员先撤销拒绝。',
        confirmLabel: '直接拒绝',
        tone: 'danger',
        details: [`投稿编号：${submission.id}`, `理由：${note}`],
      });
      if (!confirmed) return;
    }
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.community.reviewSubmission(submission.id, { decision, note }));
      // Approving is the common, low-risk action: confirm it inline on the reviewed row
      // instead of firing a bottom-right toast that competes with the list.
      if (decision !== 'approve') notify.success(decision === 'reject' ? '投稿已直接拒绝' : '投稿已退回', payload.message);
      drawer.close();
      onDone?.({ decision, id: submission.id });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        noteField.setError(error.message);
        shake(noteField);
        return;
      }
      reportError(error, '审核未完成');
    }
  }

  async function reopen() {
    const confirmed = await confirmAction({
      title: '撤销拒绝并重新审核？',
      description: '撤销后这条投稿会回到「待审核」，原拒绝理由会被清空。',
      confirmLabel: '撤销拒绝',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const payload = await runWithLoading(reopenButton, () => consoleApi.community.reviewSubmission(submission.id, { decision: 'reopen', note: '' }));
      notify.success('已撤销拒绝', payload.message);
      drawer.close();
      onDone?.({ decision: 'reopen', id: submission.id });
    } catch (error) {
      reportError(error, '操作未完成');
    }
  }
}
function openJoinDrawer({ onDone }) {
  let program = 'birthday';
  let frequency = 'weekly';

  const programControl = segmented({
    items: [
      { value: 'birthday', label: '生日祝福' },
      { value: 'morning', label: '早安晚安' },
    ],
    value: program,
    ariaLabel: '项目',
    onChange: (value) => {
      program = value;
      programControl.setValue(value);
    },
  });
  const frequencyControl = segmented({
    items: [
      { value: 'weekly', label: '按周期接收' },
      { value: 'once', label: '只参加一次' },
    ],
    value: frequency,
    ariaLabel: '接收频率',
    onChange: (value) => {
      frequency = value;
      frequencyControl.setValue(value);
    },
  });

  const consent = checkbox({
    name: 'consent',
    label: '我自愿参加，并确认可以随时退出',
    description: '选择要参与的计划。',
  });

  const submitButton = button({ label: '记录参加意愿', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '温暖连接 · 管理员试点',
    title: '加入项目',
    description: '保存后可在参与记录中查看。',
    width: 460,
    body: [
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '项目' }), programControl),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '接收频率' }), frequencyControl),
      consent,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要明确同意', '请先确认自愿参加与随时退出的规则。');
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.community.consent({ program, frequency, contentMode: 'reviewed', consent: true }));
      notify.success('已记录参加意愿', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '未能记录参加意愿');
    }
  }
}

export default async function communityPage(context, shell) {
  let tab = context.query.get('tab') || 'interests';
  const bodySlot = h('div', { class: 'stack-6' });

  const tabControl = segmented({
    items: [
      { value: 'interests', label: '参加登记' },
      { value: 'submissions', label: '投稿池审核' },
      { value: 'matching', label: '匹配预览' },
      { value: 'pilot', label: '我的参与' },
    ],
    value: tab,
    ariaLabel: '温暖连接视图',
    onChange: (value) => {
      tab = value;
      tabControl.setValue(value);
      renderTab();
    },
  });

  const interestsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '参加登记无法加载',
    load: () => consoleApi.community.interests(),
    render: (payload, { reload }) => {
      if (!payload.interests.length) {
        return emptyState({
          iconName: 'handshake',
          title: '还没有参加登记',
          description: '同学在公众端「温暖连接」页面自愿加入后即登记在这里，加入当天生效；平台不会代替任何人加入。',
          actions: [button({ label: '查看公众端页面', variant: 'secondary', iconAfter: 'external', href: '/warmth', data: { native: 'true' } })],
        });
      }
      return [
        metricRow(
          [
            metric({ label: '登记总数', value: payload.stats.total, unit: '人', animate: false }),
            metric({ label: '待人工确认', value: payload.stats.pending, unit: '人', tone: payload.stats.pending ? 'warn' : '', animate: false }),
            metric({ label: '已确认', value: payload.stats.accepted, unit: '人', animate: false }),
            metric({ label: '已退出', value: payload.stats.withdrawn, unit: '人', animate: false }),
          ],
          { columns: 4 },
        ),
        dataTable({
          columns: [
            { key: 'realName', label: '姓名 / 昵称', strong: true, render: (row) => h('span', { text: row.realName || row.nickname || '—' }) },
            { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
            { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
            { key: 'department', label: '院系 / 年级', render: (row) => h('span', { class: 't-caption', text: [row.department, row.grade].filter(Boolean).join(' · ') || '—' }) },
            { key: 'campus', label: '校区', render: (row) => h('span', { class: 't-caption', text: fmt.text(row.campus) }) },
            { key: 'contactEmail', label: '联系邮箱', render: (row) => h('span', { class: 't-caption', text: row.contactEmail || '—' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '登记时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows: payload.interests,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索姓名、学号、项目或邮箱',
          countLabel: (n) => `${n} 条登记`,
          onRowClick: (row) => openInterestDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }),
          buildRowMenu: (row) => [
            { label: '查看登记详情', iconName: 'eye', onSelect: () => openInterestDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }) },
            { separator: true },
            { label: '确认参加', iconName: 'check', disabled: row.status === '已确认', onSelect: async () => { await consoleApi.community.decideInterest(row.id, 'confirm'); notify.success('已确认参加', row.nickname); reload(); } },
            { label: '登记退出', iconName: 'close', variant: 'danger', onSelect: () => openInterestDrawer(row, { onDone: reload }) },
          ],
        }),
        notice('审核端可查看成员的完整联系信息；内容真实发送前仍需管理员逐批确认。', { tone: 'neutral', iconName: 'lock' }),
      ];
    },
  });

  // Reviewers may flip the pool between the default "待处理" queue and one that also lists approved rows.
  let submissionsShowApproved = false;

  const submissionsRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(6),
    errorTitle: '投稿池无法加载',
    load: () => consoleApi.community.submissions(),
    render: (payload, { reload }) => {
      const all = payload.submissions || [];
      const approvedCount = all.filter((row) => row.status === SUBMISSION_STATUS_APPROVED).length;
      const rows = (submissionsShowApproved ? all : all.filter((row) => row.status !== SUBMISSION_STATUS_APPROVED))
        .slice()
        .sort((a, b) => submissionReviewRank(a.status) - submissionReviewRank(b.status));
      const approvedToggle = button({
        label: submissionsShowApproved ? '只看待处理' : `查看已通过（${approvedCount}）`,
        variant: 'secondary',
        size: 'sm',
        iconName: submissionsShowApproved ? 'list' : 'eye',
        title: submissionsShowApproved ? '隐藏已通过的投稿' : '显示审核已通过的投稿',
        disabled: !submissionsShowApproved && !approvedCount,
        onClick: () => {
          submissionsShowApproved = !submissionsShowApproved;
          reload();
        },
      });
      if (!all.length) {
        return emptyState({
          iconName: 'inbox',
          title: '投稿池还是空的',
          description: '只有已主动加入项目的参与者才能投稿。投稿会先进入待审核队列，审核通过也不会自动发送。',
        });
      }
      return [
        metricRow(
          [
            metric({ label: '投稿总数', value: payload.stats.total, unit: '条', animate: false }),
            metric({ label: '待审核', value: payload.stats.pending, unit: '条', tone: payload.stats.pending ? 'warn' : '', animate: false }),
            metric({ label: '等待对方', value: payload.stats.waiting, unit: '条', tone: payload.stats.waiting ? 'warn' : '', animate: false }),
            metric({ label: '已通过', value: payload.stats.approved, unit: '条', animate: false }),
            metric({ label: '已拒绝', value: payload.stats.rejected, unit: '条', animate: false }),
          ],
          { columns: 5 },
        ),
        dataTable({
          columns: [
            { key: 'id', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
            { key: 'content', label: '内容摘要', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'tone', label: '语气' },
            { key: 'nickname', label: '署名昵称', render: (row) => h('span', { class: 't-caption', text: row.nickname || '—' }) },
            { key: 'delivery', label: '投递方式', render: (row) => h('span', { class: 't-caption', text: row.delivery || '—' }) },
            { key: 'deliveryState', label: '投递条件', render: (row) => h('span', { class: 't-caption', text: row.deliveryState || '—' }) },
            { key: 'actor', label: '投稿人' },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索内容、项目或投稿人',
          actions: [approvedToggle],
          countLabel: (n) => (submissionsShowApproved
            ? `${n} 条（含 ${approvedCount} 条已通过）`
            : approvedCount ? `${n} 条待处理 · 已隐藏 ${approvedCount} 条已通过` : `${n} 条投稿`),
          empty: emptyState({
            iconName: 'inbox',
            title: '没有待处理的投稿',
            description: `审核已通过的 ${approvedCount} 条投稿已隐藏，可点击“查看已通过”查看。`,
          }),
          onRowClick: (row) =>
            openSubmissionReviewDrawer(row, {
              onDone: async () => {
                await reload();
                shell.refreshTodos();
              },
            }),
        }),
      ];
    },
  });

  const libraryRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '祝福库无法加载',
    load: () => consoleApi.community.blessingLibrary(),
    render: (payload) => {
      if (!payload.items.length) {
        return emptyState({
          iconName: 'archive',
          title: '祝福库还是空的',
          description: '投稿审核通过后会自动入库，并按投递方式分为祝福仓库 / 指定个体 / 一对一随机三类。',
        });
      }
      return [
        metricRow(
          [
            metric({ label: '在库总数', value: payload.stats.active, unit: '条', animate: false }),
            metric({ label: '祝福仓库', value: payload.stats.repository, unit: '条', animate: false }),
            metric({ label: '指定个体', value: payload.stats.specific, unit: '条', animate: false }),
            metric({ label: '一对一随机', value: payload.stats.random, unit: '条', animate: false }),
          ],
          { columns: 4 },
        ),
        dataTable({
          columns: [
            { key: 'submissionId', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.submissionId }) },
            { key: 'category', label: '分类', render: (row) => badge(row.category, { tone: 'accent' }) },
            { key: 'content', label: '内容', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'nickname', label: '署名昵称', render: (row) => h('span', { class: 't-caption', text: row.nickname || '—' }) },
            { key: 'targetStudentId', label: '目标学号', render: (row) => h('span', { class: 't-data', text: row.targetStudentId || '—' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => badge(row.status, { tone: row.status === '在库' ? 'success' : 'neutral', iconName: row.status === '在库' ? 'check' : null }) },
            { key: 'storedAt', label: '入库时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.storedAt) }) },
          ],
          rows: payload.items,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索内容、分类或昵称',
          countLabel: (n) => `${n} 条在库记录`,
        }),
        notice('分类入库只做归档，不会自动发送或匹配；真正的投递与配额仍待实现。', { tone: 'neutral', iconName: 'lock' }),
      ];
    },
  });

  const matchingRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(4),
    errorTitle: '匹配预览无法加载',
    load: () => consoleApi.community.matchingPreview(),
    render: (payload) => [
      notice(payload.message, { tone: 'warning', iconName: 'alert', title: '预览模式：不创建关系、不发送消息' }),
      h(
        'div',
        { class: 'wscols' },
        h(
          'div',
          { class: 'stack-6' },
          region({
            label: '候选统计',
            title: `共 ${payload.candidateCount} 位候选参与者`,
            description: '只统计已明确同意且未退出的参与者数量，不生成任何配对关系。',
            dense: true,
            body: h(
              'div',
              { class: 'stack-4' },
              ...payload.byProgram.map((entry) =>
                h(
                  'div',
                  { class: 'stack-2' },
                  h('div', { class: 'row-between' }, h('span', { class: 't-secondary t-strong', text: PROGRAM_LABEL[entry.program] || entry.program }), h('span', { class: 't-data', text: `${entry.eligible} 人` })),
                  h('p', { class: 't-caption', text: `其中按周期接收 ${entry.weekly} 人` }),
                ),
              ),
            ),
          }),
        ),
        h(
          'div',
          { class: 'stack-6' },
          region({
            label: '构成',
            title: '候选分布',
            dense: true,
            body: payload.candidateCount
              ? donutChart({
                  segments: payload.byProgram.map((entry, index) => ({
                    label: PROGRAM_LABEL[entry.program] || entry.program,
                    value: entry.eligible,
                    color: index === 0 ? 'var(--accent)' : 'var(--info)',
                  })),
                  centerValue: payload.candidateCount,
                  centerLabel: '候选总数',
                })
              : emptyState({ iconName: 'users', title: '还没有候选参与者', description: '需要有人自愿加入并被确认后才会进入候选统计。' }),
          }),
          region({
            label: '生成时间',
            title: '预览快照',
            dense: true,
            body: definitionList([
              ['生成时间', fmt.fullDateTime(payload.generatedAt)],
              ['模式', payload.mode],
              ['配对关系', `${payload.pairs.length} 组（始终为 0）`],
              ['人工确认', payload.requiresManualApproval ? '必需' : '不需要'],
            ]),
          }),
        ),
      ),
    ],
  });

  const pilotRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(3),
    errorTitle: '试点状态无法加载',
    load: () => consoleApi.community.overview(),
    render: (payload, { reload }) => [
      metricRow(
        [
          metric({ label: '当前有效同意', value: payload.stats.active, unit: '条', animate: false }),
          metric({ label: '我参与的项目', value: payload.stats.currentUserActive, unit: '个', animate: false }),
        ],
        { columns: 2 },
      ),
      payload.current.length
        ? h(
            'div',
            { class: 'stack-3' },
            ...payload.current.map((entry) =>
              h(
                'div',
                { class: 'row-3 pilot-row' },
                icon(entry.program === 'birthday' ? 'sparkle' : 'handshake', 'ico ico--lg'),
                h(
                  'div',
                  { class: 'stack-1 spacer' },
                  h('b', { class: 't-secondary t-strong', text: PROGRAM_LABEL[entry.program] || entry.program }),
                  h('p', { class: 't-caption', text: `${FREQUENCY_LABEL[entry.frequency] || entry.frequency} · 更新于 ${fmt.relative(entry.updatedAt)}` }),
                ),
                statusIndicator('已加入', { tone: 'success' }),
                button({
                  label: '退出项目',
                  variant: 'danger',
                  size: 'sm',
                  iconName: 'close',
                  onClick: async () => {
                    const confirmed = await confirmAction({
                      title: `退出${PROGRAM_LABEL[entry.program]}？`,
                      description: '退出后不会再进入匹配与发送队列。你随时可以重新加入。',
                      confirmLabel: '退出项目',
                      tone: 'danger',
                    });
                    if (!confirmed) return;
                    try {
                      await consoleApi.community.withdraw(entry.program);
                      notify.success('已退出项目');
                      reload();
                    } catch (error) {
                      reportError(error, '退出未完成');
                    }
                  },
                }),
              ),
            ),
          )
        : emptyState({
            iconName: 'heart',
            title: '你还没有参加任何温暖连接项目',
            description: '管理员也可以作为普通参与者加入试点，用来验证同意、审核与退出流程是否顺畅。',
            actions: [button({ label: '加入项目', variant: 'primary', iconName: 'plus', onClick: () => openJoinDrawer({ onDone: reload }) })],
          }),
      payload.current.length ? button({ label: '加入另一个项目', variant: 'secondary', iconName: 'plus', onClick: () => openJoinDrawer({ onDone: reload }) }) : null,
    ],
  });

  function renderTab() {
    clear(bodySlot);
    const current = tab === 'submissions' ? submissionsRegion : tab === 'matching' ? matchingRegion : tab === 'pilot' ? pilotRegion : interestsRegion;
    current.ensureLoaded();
    bodySlot.append(h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), reloadAction(current, '刷新')), current);
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '温暖连接',
      title: '安全互动控制台',
      description: '这个模块的重点不是匹配结果，而是同意、审核、退出与举报是否都处在可控状态。默认不自动发送任何内容。',
      meta: [statusIndicator('默认不自动发送', { tone: 'warning' })],
      actions: [button({ label: '公众端项目页', variant: 'ghost', iconAfter: 'external', href: '/warmth', data: { native: 'true' } })],
    }),
    bodySlot,
  );

  renderTab();
  return { title: '温暖连接', crumb: '温暖连接', node };
}
