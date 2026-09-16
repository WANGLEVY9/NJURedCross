/* ==========================================================================
   console/pages/outreach.js — content production line.
   Board view mirrors the real pipeline: 征集 → 待审核 → 修改中 → 已通过 →
   待排期 → 已发布. Reviews and scheduling happen in drawers.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake, stagger } from '../../core/motion.js';
import { openDrawer } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction, WRITE_NOTICE } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, checkbox, notice,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor, definitionList,
  copyableCode, runWithLoading, timeline,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const CHANNELS = [
  { value: 'site', label: '平台页面' },
  { value: 'email', label: '校内邮件' },
  { value: 'wechat', label: '微信公众号' },
  { value: 'qq', label: 'QQ 群公告' },
];

const BOARD_COLUMNS = [
  { key: 'collected', label: '已收集', tone: 'neutral', match: (item) => !item.review && (item.status === '已收集' || item.status === '有反馈' || item.status === '待补充') },
  { key: 'returned', label: '待修改', tone: 'warning', match: (item) => item.review?.decision === 'return' },
  { key: 'approved', label: '已通过 · 待排期', tone: 'success', match: (item) => item.review?.decision === 'approve' && !item.publication },
  { key: 'scheduled', label: '待人工发布', tone: 'info', match: (item) => item.publication?.status === '待人工发布' },
  { key: 'published', label: '已发布 / 失败', tone: 'accent', match: (item) => item.publication?.status === '已发布' || item.publication?.status === '发布失败待重试' },
];

/* --------------------------------------------------------------------------
   Review drawer (shared by content assets and public submissions)
   -------------------------------------------------------------------------- */
function openReviewDrawer({ eyebrow, title, meta, content, onSubmit }) {
  let decision = 'approve';
  const noteField = field({ label: '审核意见', name: 'note', multiline: true, rows: 4, placeholder: '通过时可以留空；退回修改必须写明具体意见' });
  const hintNode = h('p', { class: 't-caption' });

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
      hintNode.textContent = value === 'approve' ? '通过后可以进入渠道排期，仍需人工确认后才对外发布。' : '退回后投稿人会收到具体修改意见；必须填写审核意见。';
    },
  });
  hintNode.textContent = '通过后可以进入渠道排期，仍需人工确认后才对外发布。';

  const submitButton = button({ label: '提交审核结果', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow,
    title,
    width: 560,
    body: [
      meta,
      h('hr', { class: 'divider' }),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '内容' }), h('div', { class: 'content-preview t-secondary', text: content || '（无正文）' })),
      h('hr', { class: 'divider' }),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '审核结果' }), decisionControl, hintNode),
      noteField,
      notice(WRITE_NOTICE, { tone: 'neutral', iconName: 'shield' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    noteField.setError(null);
    const note = noteField.control.value.trim();
    if (decision === 'return' && !note) {
      noteField.setError('退回修改必须填写审核意见');
      shake(noteField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () => onSubmit({ decision, note }));
      notify.success(decision === 'approve' ? '已审核通过' : '已退回修改', payload?.message || title);
      drawer.close();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.isConflict)) {
        noteField.setError(error.message);
        shake(noteField);
        return;
      }
      reportError(error, '审核未完成');
    }
  }
}

/* --------------------------------------------------------------------------
   Schedule + result drawers
   -------------------------------------------------------------------------- */
function openScheduleDrawer(item, { onDone }) {
  const channelField = field({ label: '发布渠道', name: 'channel', options: CHANNELS, value: 'site' });
  const plannedField = field({ label: '计划发布时间', name: 'plannedAt', type: 'datetime-local', required: true });
  const noteField = field({ label: '发布备注', name: 'note', multiline: true, rows: 2, placeholder: '需要配图、需要负责人确认文案等' });
  const confirmManual = checkbox({
    name: 'manual',
    label: '我理解平台不会自动向外部渠道发送',
    description: '排期只会创建一条「待人工发布」任务。实际发布仍由运营同学在对应渠道完成，并回到平台登记结果。',
  });

  const submitButton = button({ label: '创建排期任务', variant: 'primary', iconName: 'clock', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '发布排期',
    title: item.title,
    description: `${item.type} · ${item.source}`,
    width: 480,
    body: [h('div', { class: 'formgrid' }, channelField, plannedField), noteField, confirmManual],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    plannedField.setError(null);
    if (!plannedField.control.value) {
      plannedField.setError('请选择计划发布时间');
      shake(plannedField);
      return;
    }
    if (!confirmManual.control.checked) {
      shake(confirmManual);
      notify.warning('需要确认发布方式', '请确认外部渠道仍由人工发布。');
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.outreach.schedule(item.id, {
          channel: channelField.control.value,
          plannedAt: new Date(plannedField.control.value).toISOString(),
          note: noteField.control.value.trim(),
        }),
      );
      notify.success('排期任务已创建', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.isConflict)) {
        plannedField.setError(error.message);
        shake(plannedField);
        return;
      }
      reportError(error, '排期未创建');
    }
  }
}

function openResultDrawer(item, { onDone }) {
  let status = 'published';
  const linkField = field({ label: '发布链接', name: 'publishedLink', placeholder: 'https://…', hint: '记录对外可访问的地址，便于日后核对。' });
  const reasonField = field({ label: '失败原因', name: 'failureReason', multiline: true, rows: 3, placeholder: '例如：公众号素材未通过审核、群公告被限流' });
  reasonField.hidden = true;

  const statusControl = segmented({
    items: [
      { value: 'published', label: '已发布' },
      { value: 'failed', label: '发布失败' },
    ],
    value: status,
    ariaLabel: '发布结果',
    onChange: (value) => {
      status = value;
      statusControl.setValue(value);
      linkField.hidden = value === 'failed';
      reasonField.hidden = value === 'published';
    },
  });

  const submitButton = button({ label: '登记结果', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '发布结果登记',
    title: item.title,
    description: `${item.publication.channel} · 计划 ${fmt.fullDateTime(item.publication.plannedAt)} · 已重试 ${item.publication.retryCount || 0} 次`,
    width: 480,
    body: [
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '发布结果' }), statusControl),
      linkField,
      reasonField,
      notice('登记失败会递增重试次数并保留「发布失败待重试」状态，不会被静默视为成功。', { tone: 'warning' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    reasonField.setError(null);
    if (status === 'failed' && !reasonField.control.value.trim()) {
      reasonField.setError('发布失败必须填写原因');
      shake(reasonField);
      return;
    }
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.outreach.result(item.id, {
          status,
          publishedLink: linkField.control.value.trim(),
          failureReason: reasonField.control.value.trim(),
        }),
      );
      notify.success('结果已登记', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '结果未登记');
    }
  }
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */
export default async function outreachPage(context, shell) {
  let tab = context.query.get('tab') || 'board';
  const bodySlot = h('div', { class: 'stack-6' });

  const tabControl = segmented({
    items: [
      { value: 'board', label: '内容看板' },
      { value: 'public', label: '公众投稿' },
      { value: 'tasks', label: '发布任务' },
      { value: 'schema', label: '数据结构' },
    ],
    value: tab,
    ariaLabel: '宣传中心视图',
    onChange: (value) => {
      tab = value;
      tabControl.setValue(value);
      renderTab();
    },
  });

  /* ---- Board ------------------------------------------------------------ */
  const boardRegion = asyncRegion({
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '宣传内容无法加载',
    load: () => consoleApi.outreach.overview(),
    render: (payload, { reload }) => {
      const showInspector = (item) => {
        shell.openInspector({
          eyebrow: item.type,
          title: item.title,
          subtitle: item.source,
          body: [
            h('div', { class: 'row-3 row-wrap' }, statusFor(item.status), badge(item.authorization || '待核对', { tone: 'neutral', iconName: 'shield' })),
            definitionList([
              ['内容标识', copyableCode(item.id)],
              ['投稿人', item.author],
              ['提交时间', fmt.fullDateTime(item.submittedAt)],
              ['授权状态', item.authorization || '待核对'],
            ]),
            h('hr', { class: 'divider' }),
            h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '摘要' }), h('div', { class: 'content-preview t-secondary', text: item.summary || '暂无摘要' })),
            item.review
              ? h(
                  'div',
                  { class: 'stack-3' },
                  h('p', { class: 't-label', text: '审核记录' }),
                  timeline([
                    {
                      title: item.review.decision === 'approve' ? '审核通过' : '退回修改',
                      description: item.review.note || '（无意见）',
                      at: item.review.reviewedAt,
                      state: item.review.decision === 'approve' ? 'done' : 'blocked',
                      badge: badge(item.review.reviewer, { tone: 'neutral', iconName: 'user' }),
                    },
                  ]),
                )
              : notice('这条内容还没有审核记录。审核结果保存在服务端本地记录中，与 SeaTable 原始内容隔离。', { tone: 'info' }),
            item.publication
              ? h(
                  'div',
                  { class: 'stack-3' },
                  h('p', { class: 't-label', text: '发布任务' }),
                  definitionList([
                    ['任务编号', item.publication.taskId],
                    ['渠道', item.publication.channel],
                    ['计划时间', fmt.fullDateTime(item.publication.plannedAt)],
                    ['状态', item.publication.status],
                    ['重试次数', String(item.publication.retryCount || 0)],
                    item.publication.publishedLink ? ['发布链接', item.publication.publishedLink] : null,
                    item.publication.failureReason ? ['失败原因', item.publication.failureReason] : null,
                  ]),
                )
              : null,
          ].filter(Boolean),
          footer: [
            button({
              label: item.review ? '重新审核' : '开始审核',
              variant: 'primary',
              size: 'sm',
              block: true,
              iconName: 'eye',
              onClick: () =>
                openReviewDrawer({
                  eyebrow: `${item.type} · ${item.source}`,
                  title: item.title,
                  meta: definitionList([
                    ['投稿人', item.author],
                    ['提交时间', fmt.fullDateTime(item.submittedAt)],
                    ['授权状态', item.authorization || '待核对'],
                  ]),
                  content: item.summary,
                  onSubmit: async ({ decision, note }) => {
                    const result = await consoleApi.outreach.review(item.id, { decision, note });
                    shell.closeInspector();
                    reload();
                    shell.refreshTodos();
                    return result;
                  },
                }),
            }),
            h(
              'div',
              { class: 'row-2' },
              button({
                label: '创建排期',
                variant: 'secondary',
                size: 'sm',
                iconName: 'clock',
                disabled: item.review?.decision !== 'approve',
                onClick: () => openScheduleDrawer(item, { onDone: () => { shell.closeInspector(); reload(); } }),
              }),
              item.publication
                ? button({ label: '登记结果', variant: 'secondary', size: 'sm', iconName: 'send', onClick: () => openResultDrawer(item, { onDone: () => { shell.closeInspector(); reload(); } }) })
                : null,
            ),
          ].filter(Boolean),
        });
      };

      const board = h('div', { class: 'board' });
      for (const column of BOARD_COLUMNS) {
        const items = payload.campaigns.filter(column.match);
        board.append(
          h(
            'div',
            { class: 'board__col' },
            h(
              'header',
              { class: 'board__head' },
              h('span', { class: 't-label', text: column.label }),
              h('span', { class: 'spacer' }),
              badge(String(items.length), { tone: items.length ? column.tone : 'neutral', count: true }),
            ),
            items.length
              ? (() => {
                  const list = h(
                    'div',
                    { class: 'board__items' },
                    ...items.map((item) =>
                      h(
                        'button',
                        { class: 'board__card', type: 'button', on: { click: () => showInspector(item) } },
                        h('div', { class: 'row-2 row-wrap' }, badge(item.type, { tone: 'accent' })),
                        h('span', { class: 't-secondary t-strong t-clamp-2', text: item.title }),
                        h('span', { class: 't-caption t-clamp-2', text: item.summary || '暂无摘要' }),
                        h('div', { class: 'row-2 row-between' }, h('span', { class: 't-caption t-faint', text: item.author }), h('span', { class: 't-caption t-faint', text: fmt.relative(item.submittedAt) })),
                      ),
                    ),
                  );
                  stagger(list);
                  return list;
                })()
              : h('p', { class: 't-caption t-faint board__empty', text: '这一阶段没有内容' }),
          ),
        );
      }

      return [
        metricRow(
          [
            metric({ label: '内容资产', value: payload.stats.contentCount, unit: '条' }),
            metric({ label: '待审核', value: payload.stats.reviewPending, unit: '条', tone: payload.stats.reviewPending ? 'warn' : '' }),
            metric({ label: '已通过', value: payload.stats.reviewApproved, unit: '条' }),
            metric({ label: '待人工发布', value: payload.stats.publicationPending, unit: '条', tone: payload.stats.publicationPending ? 'warn' : '' }),
          ],
          { columns: 4 },
        ),
        notice(`来源：${payload.sources.join('、')}。审核与排期记录保存在服务端本地，等正式宣传表结构确认后再迁移。`, { tone: 'neutral', iconName: 'info' }),
        payload.campaigns.length
          ? board
          : emptyState({
              iconName: 'megaphone',
              title: '还没有可审核的内容资产',
              description: '策划案、文创征集与课程反馈会自动汇总到这里。公众端的新投稿会出现在「公众投稿」标签下。',
            }),
      ];
    },
  });

  /* ---- Public submissions ----------------------------------------------- */
  const publicRegion = asyncRegion({
    skeleton: skeletonRows(6),
    errorTitle: '公众投稿无法加载',
    load: () => consoleApi.outreach.publicSubmissions(),
    render: (payload, { reload }) => {
      if (!payload.submissions.length) {
        return emptyState({
          iconName: 'inbox',
          title: '还没有来自公众端的投稿',
          description: '同学在公众端「内容投稿」提交后会立即进入这个队列，并在通知中心标记为高优先级。',
          actions: [button({ label: '查看公众端投稿页', variant: 'secondary', iconAfter: 'external', href: '/submit', data: { native: 'true' } })],
        });
      }
      return [
        metricRow(
          [
            metric({ label: '投稿总数', value: payload.stats.total, unit: '篇', animate: false }),
            metric({ label: '待审核', value: payload.stats.pending, unit: '篇', tone: payload.stats.pending ? 'warn' : '', animate: false }),
            metric({ label: '已通过', value: payload.stats.approved, unit: '篇', animate: false }),
            metric({ label: '已退回', value: payload.stats.returned, unit: '篇', animate: false }),
          ],
          { columns: 4 },
        ),
        dataTable({
          columns: [
            { key: 'title', label: '标题', strong: true, render: (row) => h('div', { class: 'stack-1' }, h('span', { class: 't-secondary t-strong t-clamp-1', text: row.title }), h('span', { class: 't-caption t-clamp-1', text: row.excerpt })) },
            { key: 'category', label: '类型', render: (row) => badge(row.category, { tone: 'accent' }) },
            { key: 'signature', label: '署名方式' },
            { key: 'contact', label: '联系人', render: (row) => h('span', { class: 't-caption', text: `${row.contact} · ${row.contactEmail}` }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows: payload.submissions,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索标题、类型或正文',
          searchKeys: ['title', 'category', 'excerpt'],
          countLabel: (n) => `${n} 篇投稿`,
          onRowClick: (row) =>
            openReviewDrawer({
              eyebrow: `公众投稿 · ${row.category}`,
              title: row.title,
              meta: definitionList([
                ['投稿编号', copyableCode(row.id)],
                ['署名方式', row.signature],
                ['联系人', `${row.contact} · ${row.contactEmail}`],
                ['肖像授权', row.portraitConfirm ? '已确认' : '未涉及/未确认'],
                ['提交时间', fmt.fullDateTime(row.submittedAt)],
                ['当前状态', row.status],
              ]),
              content: row.content,
              onSubmit: async ({ decision, note }) => {
                const result = await consoleApi.outreach.reviewPublicSubmission(row.id, { decision, note });
                reload();
                shell.refreshTodos();
                return result;
              },
            }),
          buildRowMenu: (row) => [
            { label: '审核这篇投稿', iconName: 'eye', onSelect: () => {} },
            { label: '复制投稿编号', iconName: 'copy', onSelect: () => navigator.clipboard?.writeText(row.id) },
          ],
        }),
      ];
    },
  });

  /* ---- Publication tasks ------------------------------------------------ */
  const tasksRegion = asyncRegion({
    skeleton: skeletonRows(5),
    errorTitle: '发布任务无法加载',
    load: () => consoleApi.outreach.overview(),
    render: (payload, { reload }) => {
      const tasks = payload.campaigns.filter((item) => item.publication);
      if (!tasks.length) {
        return emptyState({
          iconName: 'send',
          title: '还没有发布任务',
          description: '审核通过的内容可以创建渠道排期。任务默认为「待人工发布」，平台不会自动向外部渠道发送。',
          actions: [button({ label: '前往内容看板', variant: 'primary', onClick: () => { tab = 'board'; tabControl.setValue('board'); renderTab(); } })],
        });
      }
      return dataTable({
        columns: [
          { key: 'title', label: '内容', strong: true },
          { key: 'channel', label: '渠道', value: (row) => row.publication.channel, render: (row) => badge(CHANNELS.find((c) => c.value === row.publication.channel)?.label || row.publication.channel, { tone: 'info' }) },
          { key: 'plannedAt', label: '计划时间', value: (row) => row.publication.plannedAt, render: (row) => h('span', { class: 't-caption', text: fmt.fullDateTime(row.publication.plannedAt) }) },
          { key: 'status', label: '状态', value: (row) => row.publication.status, sortable: false, render: (row) => statusFor(row.publication.status) },
          { key: 'retry', label: '重试', align: 'right', value: (row) => row.publication.retryCount || 0 },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            tight: true,
            render: (row) =>
              h('div', { class: 'cell--actions row-2' }, button({ label: '登记结果', variant: 'secondary', size: 'sm', iconName: 'check', onClick: () => openResultDrawer(row, { onDone: reload }) })),
          },
        ],
        rows: tasks,
        getKey: (row) => row.id,
        searchPlaceholder: '搜索内容或渠道',
        countLabel: (n) => `${n} 个发布任务`,
      });
    },
  });

  /* ---- Schema preview --------------------------------------------------- */
  const schemaRegion = asyncRegion({
    skeleton: skeletonRows(4),
    errorTitle: '结构预览无法加载',
    load: () => consoleApi.outreach.schemaPreview(),
    render: (payload) => [
      notice('这是只读的结构预览（dry-run），不会创建表或写入数据。宣传业务表确认后才会迁移本地审核与排期记录。', { tone: 'warning', iconName: 'alert', title: '预览模式' }),
      h(
        'div',
        { class: 'stack-5' },
        ...payload.tables.map((table) =>
          region({
            label: table.exists ? '已存在' : '尚未创建',
            title: table.name,
            description: table.purpose,
            actions: [table.exists ? badge('已存在', { tone: 'success' }) : badge('待创建', { tone: 'warning' })],
            dense: true,
            body: h(
              'div',
              { class: 'stack-3' },
              h(
                'div',
                { class: 'row-2 row-wrap' },
                ...table.columns.map((column) =>
                  badge(column, { tone: table.matchedColumns.includes(column) ? 'success' : 'neutral', iconName: table.matchedColumns.includes(column) ? 'check' : null }),
                ),
              ),
              table.missingColumns.length ? h('p', { class: 't-caption', text: `缺少字段：${table.missingColumns.join('、')}` }) : null,
              table.extraColumns.length ? h('p', { class: 't-caption t-faint', text: `额外字段：${table.extraColumns.join('、')}` }) : null,
            ),
          }),
        ),
      ),
    ],
  });

  function renderTab() {
    clear(bodySlot);
    const current = tab === 'public' ? publicRegion : tab === 'tasks' ? tasksRegion : tab === 'schema' ? schemaRegion : boardRegion;
    bodySlot.append(
      h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), reloadAction(current, '刷新')),
      current,
    );
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '宣传中心',
      title: '内容发布生产线',
      description: '征集、审核、排期与发布结果登记在一条流水线上。外部渠道仍由人工确认发布，平台负责记录与追溯。',
      actions: [button({ label: '公众端投稿页', variant: 'ghost', iconAfter: 'external', href: '/submit', data: { native: 'true' } })],
    }),
    bodySlot,
  );

  renderTab();
  return { title: '宣传中心', crumb: '宣传中心', node };
}
