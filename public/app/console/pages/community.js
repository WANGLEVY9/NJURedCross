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
import { asyncRegion, region, reloadAction, WRITE_NOTICE } from '../lib.js';
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

function openInterestDrawer(interest, { onDone }) {
  const drawer = openDrawer({
    eyebrow: `${PROGRAM_LABEL[interest.program] || interest.program} · 参加登记`,
    title: interest.nickname,
    description: `${FREQUENCY_LABEL[interest.frequency] || interest.frequency} · ${fmt.relative(interest.submittedAt)}`,
    width: 480,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(interest.status), badge(`同意版本 v1`, { tone: 'neutral', iconName: 'shield' })),
      definitionList([
        ['登记编号', copyableCode(interest.id)],
        ['项目', PROGRAM_LABEL[interest.program] || interest.program],
        ['显示昵称', interest.nickname],
        ['联系邮箱', interest.contactEmail],
        ['校区', fmt.text(interest.campus)],
        interest.birthdayMonthDay ? ['生日（月-日）', interest.birthdayMonthDay] : null,
        ['接收频率', FREQUENCY_LABEL[interest.frequency] || interest.frequency],
        ['登记时间', fmt.fullDateTime(interest.submittedAt)],
        interest.handledBy ? ['处理人', `${interest.handledBy} · ${fmt.fullDateTime(interest.handledAt)}`] : null,
      ]),
      interest.note ? h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '参与者备注' }), h('div', { class: 'content-preview t-secondary', text: interest.note })) : null,
      notice('确认参加只表示这个人进入候选池。任何内容仍需经过人工审核，并由管理员确认批次后才会由平台转达。', { tone: 'info', title: '确认的含义' }),
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
  const noteField = field({ label: '审核意见', name: 'note', multiline: true, rows: 3, placeholder: '退回时必须写明原因，例如包含联系方式、语气不当或涉及隐私' });
  const decisionControl = segmented({
    items: [
      { value: 'approve', label: '审核通过' },
      { value: 'return', label: '退回修改' },
    ],
    value: decision,
    ariaLabel: '审核结果',
    onChange: (value) => {
      decision = value;
      decisionControl.setValue(value);
    },
  });

  const submitButton = button({ label: '提交审核结果', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: `${PROGRAM_LABEL[submission.program] || submission.program} · 投稿审核`,
    title: `投稿 ${submission.id}`,
    description: `${submission.tone} · ${fmt.relative(submission.submittedAt)}`,
    width: 500,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(submission.status), badge(submission.actor, { tone: 'neutral', iconName: 'user' })),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '投稿内容' }), h('div', { class: 'content-preview t-secondary', text: submission.content })),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '审核结果' }), decisionControl),
      noteField,
      notice('审核通过不会触发匹配或发送。发送仍需管理员在确认批次后逐步执行。', { tone: 'info' }),
      notice(WRITE_NOTICE, { tone: 'neutral', iconName: 'shield' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    noteField.setError(null);
    const note = noteField.control.value.trim();
    if (decision === 'return' && !note) {
      noteField.setError('退回投稿必须填写审核意见');
      shake(noteField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.community.reviewSubmission(submission.id, { decision, note }));
      notify.success(decision === 'approve' ? '投稿审核通过' : '投稿已退回', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        noteField.setError(error.message);
        shake(noteField);
        return;
      }
      reportError(error, '审核未完成');
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
    description: '管理员参与试点与普通参与者遵循同一规则：内容需人工审核，平台不自动发送，退出立即生效。',
  });

  const submitButton = button({ label: '记录参加意愿', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '温暖连接 · 管理员试点',
    title: '加入项目',
    description: '试点记录只保存在服务端本地，不读取生日、不自动匹配、不发送邮件、不写入第二个 SeaTable Base。',
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
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '参加登记无法加载',
    load: () => consoleApi.community.interests(),
    render: (payload, { reload }) => {
      if (!payload.interests.length) {
        return emptyState({
          iconName: 'handshake',
          title: '还没有参加登记',
          description: '同学在公众端「温暖连接」页面自愿加入后会进入这个队列，等待人工确认。平台不会代替任何人加入。',
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
            { key: 'nickname', label: '显示昵称', strong: true },
            { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
            { key: 'frequency', label: '频率', render: (row) => h('span', { class: 't-caption', text: FREQUENCY_LABEL[row.frequency] || row.frequency }) },
            { key: 'campus', label: '校区', render: (row) => h('span', { class: 't-caption', text: fmt.text(row.campus) }) },
            { key: 'contactEmail', label: '联系邮箱', render: (row) => h('span', { class: 't-caption', text: row.contactEmail }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '登记时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows: payload.interests,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索昵称、项目或校区',
          countLabel: (n) => `${n} 条登记`,
          onRowClick: (row) => openInterestDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }),
          buildRowMenu: (row) => [
            { label: '查看登记详情', iconName: 'eye', onSelect: () => openInterestDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }) },
            { separator: true },
            { label: '确认参加', iconName: 'check', disabled: row.status === '已确认', onSelect: async () => { await consoleApi.community.decideInterest(row.id, 'confirm'); notify.success('已确认参加', row.nickname); reload(); } },
            { label: '登记退出', iconName: 'close', variant: 'danger', onSelect: () => openInterestDrawer(row, { onDone: reload }) },
          ],
        }),
        notice('联系邮箱在返回前已做脱敏处理。确认参加不等于同意发送：真实发送前仍需管理员逐批确认。', { tone: 'neutral', iconName: 'lock' }),
      ];
    },
  });

  const submissionsRegion = asyncRegion({
    skeleton: skeletonRows(6),
    errorTitle: '投稿池无法加载',
    load: () => consoleApi.community.submissions(),
    render: (payload, { reload }) => {
      if (!payload.submissions.length) {
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
            metric({ label: '已通过', value: payload.stats.approved, unit: '条', animate: false }),
          ],
          { columns: 3 },
        ),
        dataTable({
          columns: [
            { key: 'id', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
            { key: 'content', label: '内容摘要', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'tone', label: '语气' },
            { key: 'actor', label: '投稿人' },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows: payload.submissions,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索内容、项目或投稿人',
          countLabel: (n) => `${n} 条投稿`,
          onRowClick: (row) => openSubmissionReviewDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }),
        }),
      ];
    },
  });

  const matchingRegion = asyncRegion({
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
          region({
            label: '发送前置条件',
            title: '在开放真实发送之前必须完成',
            dense: true,
            body: timeline([
              { title: '同意与退出闭环', description: '加入、退出、屏蔽与举报入口全部可用并可追溯。', state: 'done', iconName: 'shield' },
              { title: '内容人工审核', description: '投稿池审核已启用；退回必须填写意见。', state: 'done', iconName: 'eye' },
              { title: '匹配规则版本化', description: '硬性规则、批次号与可解释理由，首版不使用不可解释的自动匹配。', state: 'active', iconName: 'flow' },
              { title: '可靠发送队列', description: '幂等键、失败重试与一键暂停发送。', iconName: 'send' },
              { title: '举报处置时限', description: '明确责任人与处理时限，并可暂停整批发送。', iconName: 'alert' },
            ]),
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
      notice(`当前模式：${payload.mode}；写入第二个 SeaTable Base：${payload.writesToSeaTable ? '是' : '否'}。试点记录只保存在服务端本地。`, { tone: 'neutral', iconName: 'info' }),
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
