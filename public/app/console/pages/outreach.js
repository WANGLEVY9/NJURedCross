import { summaryMetric as metric } from '../lib.js';
/* ==========================================================================
   console/pages/outreach.js — content production line.
   Board view mirrors the real pipeline: 征集 → 待审核 → 修改中 → 已通过 →
   待排期 → 已发布. Reviews and scheduling happen in drawers.
   ========================================================================== */

import { h, icon, clear, setVars } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer, openLightbox } from '../../ui/overlay.js';
import { recordTable as dataTable } from '../lib.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import { patchQuery } from '../../core/router.js';
import { tableStateOptions } from '../table-state.js';
import {
  pageHead, metricRow, badge, button, field, checkbox, notice,
  emptyState, segmented, skeletonMetrics, skeletonRows, skeletonLine, statusFor, definitionList,
  copyableCode, runWithLoading, timeline,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import showcaseAdminPage from './showcase.js';
import { protectDrawerDraft } from '../../ui/drawer-draft.js';

const CHANNELS = [
  { value: 'site', label: '平台页面' },
  { value: 'email', label: '校内邮件' },
  { value: 'wechat', label: '微信公众号' },
  { value: 'qq', label: 'QQ 群公告' },
];

const BOARD_COLUMNS = [
  { key: 'collected', label: '已收集 · 待初审', tone: 'neutral', match: (item) => (item.chain ? item.chain.passed === 0 && !item.chain.done && item.chain.status !== '已退回' : !item.review && (item.status === '已收集' || item.status === '有反馈' || item.status === '待补充')) },
  { key: 'reviewing', label: '审核中', tone: 'info', match: (item) => item.chain && item.chain.passed > 0 && !item.chain.done && item.chain.status !== '已退回' },
  { key: 'returned', label: '待修改', tone: 'warning', match: (item) => (item.chain ? item.chain.status === '已退回' : item.review?.decision === 'return') },
  { key: 'approved', label: '已通过 · 待排期', tone: 'success', match: (item) => (item.chain ? item.chain.done : item.review?.decision === 'approve') && !item.publication },
  { key: 'scheduled', label: '待人工发布', tone: 'info', match: (item) => item.publication?.status === '待人工发布' },
  { key: 'published', label: '已发布 / 失败', tone: 'accent', match: (item) => item.publication?.status === '已发布' || item.publication?.status === '发布失败待重试' },
];

/* --------------------------------------------------------------------------
   Review drawer — v3 multi-level workflow (制度 §4.1 / §8.8)
   · 按栏目自动带出「对接人 / 审核人」，随栏目切换实时刷新
   · 审核链进度条（文字 2 级 / 文创 3 级 / 小绿书 2 级）
   · 一审最多退回一次：同层已退回则「退回修改」置灰
   · 退回时可勾选检查项 + 填写修改意见，一键生成《审核意见》Word
   -------------------------------------------------------------------------- */
const CATEGORY_OPTIONS = [
  '活动总结', '活动预热', '人道法言', '心灵慢车', '南小红月报', '小红帮推',
  '南男女侣', '今日节日', '健康小蓝鲸', '红会新闻', '红会招新', '文创设计',
].map((value) => ({ value, label: value }));

/** 历史来源条目（博爱青春策划案 / 纪念品大赛）：不在宣传投稿表内，没有 v3 审核链。 */
function isLegacySource(item) {
  return /^(planning|creative):/.test(String(item?.id || ''));
}

/** 从 Content-Disposition 解析服务端指定的文件名（RFC 5987 UTF-8 优先）。 */
function opinionFilename(disposition, fallback) {
  const raw = String(disposition || '');
  const utf8 = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* 回退到普通 filename */ } }
  const plain = raw.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

function openReviewDrawer({
  eyebrow, title, meta, content, attachments = null, onSubmit,
  reviewFlow = null,          // v3：{ contentId, category, kind, isSubmission } 时启用多级审核
}) {
  let decision = 'approve';
  let submitting = false;
  let chain = null;           // 审核链视图
  let checklist = [];         // 21 项模板
  const checked = new Set();  // 勾选的检查项序号
  const opinions = [];        // 修改意见行 { position, problem, requirement }

  const noteField = field({ label: '审核意见', name: 'note', multiline: true, rows: 4, placeholder: '通过时可以留空；退回修改必须写明具体意见' });
  const hintNode = h('p', { class: 't-caption' });

  /* ---- 审核链进度 ---- */
  const chainSlot = h('div', { class: 'stack-2' });
  const assigneeSlot = h('div', { class: 'stack-2' });

  /* ---- 审核清单（必填：勾 = 该项已确认合格）+ 修改意见（选填） ---- */
  const checklistSlot = h('div', { class: 'stack-3' });
  const checklistError = h('p', { class: 'field__error', attrs: { role: 'alert', 'aria-live': 'polite' }, hidden: true });
  const opinionsSlot = h('div', { class: 'stack-2' });
  const reviewFormBlock = h('div', { class: 'stack-4' }, checklistSlot, checklistError, opinionsSlot);
  /** 勾选后刷新「已确认 n/N」计数与提示语；清单加载完成后由 renderChecklist 赋值。 */
  let refreshCounter = () => {};

  const decisionControl = segmented({
    items: [
      { value: 'approve', label: '审核通过' },
      { value: 'return', label: '退回修改' },
    ],
    value: decision,
    ariaLabel: '审核结果',
    onChange: (value) => setDecision(value),
  });

  function reviewHint() {
    if (decision === 'approve') {
      const total = checklist.length;
      return total
        ? `通过前须逐项确认全部检查项（已确认 ${checked.size}/${total}）；末级通过后进入渠道排期，仍需人工确认才对外发布。`
        : '通过前须逐项确认全部检查项；末级通过后进入渠道排期，仍需人工确认才对外发布。';
    }
    return '退回后投稿人会收到带检查清单的《审核意见》Word；同一级最多退回一次。';
  }

  function setDecision(value) {
    decision = value;
    decisionControl.setValue(value);
    hintNode.textContent = reviewHint();
    if (value === 'return') checklistError.hidden = true;
  }
  hintNode.textContent = reviewHint();

  /* ---- 渲染：检查清单（必填，勾 = 该项已确认合格） ----
     视觉：分组面板 + 组内一行一项，勾选后「方框填实 + 行底色 accent-soft +
     「已确认」标签」，三重信号（颜色 + 图标 + 文字），不靠颜色单独承载状态。
     头部有总进度条与「已确认 n/N」，组头有分组计数，方便逐组核完再看总数。 */
  let checkNodes = [];   // [{ id, node, input }]，供「全部确认 / 清空」批量同步

  function renderChecklist() {
    clear(checklistSlot);
    checkNodes = [];
    if (!checklist.length) return;

    const groups = new Map();
    for (const item of checklist) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }

    const counter = h('span', { class: 'checklist__count t-num', attrs: { 'aria-live': 'polite' } });
    const fill = h('i', { class: 'checklist__fill' });
    const meter = h('div', {
      class: 'checklist__meter',
      attrs: { role: 'progressbar', 'aria-label': '检查项确认进度', 'aria-valuemin': '0', 'aria-valuemax': String(checklist.length), 'aria-valuenow': '0' },
    }, fill);
    const groupCounts = new Map();   // 类别 → 计数节点

    refreshCounter = () => {
      const done = checked.size;
      const percentage = checklist.length ? Math.round((done / checklist.length) * 100) : 0;
      const complete = done === checklist.length;
      counter.replaceChildren(
        h('b', { text: `${done} / ${checklist.length}` }),
        h('small', { text: complete ? ' · 已全部确认' : ' 项已确认' }),
      );
      counter.dataset.complete = String(complete);
      setVars(fill, { w: `${percentage}%` });
      meter.dataset.complete = String(complete);
      meter.setAttribute('aria-valuenow', String(done));
      for (const [category, node] of groupCounts) {
        const items = groups.get(category) || [];
        const groupDone = items.filter((item) => checked.has(item.id)).length;
        node.textContent = `${groupDone}/${items.length}`;
        node.dataset.complete = String(groupDone === items.length);
      }
      hintNode.textContent = reviewHint();
    };

    checklistSlot.append(
      h('div', { class: 'checklist' },
        h('div', { class: 'checklist__head' },
          h('div', { class: 'stack-1' },
            h('p', { class: 'checklist__title', text: '审核检查清单' }),
            h('p', { class: 'checklist__sub', text: `勾选即代表该项已确认合格；共 ${checklist.length} 项，分 ${groups.size} 组。` })),
          counter),
        meter,
        h('div', { class: 'checklist__actions' },
          button({ label: '全部确认', variant: 'ghost', size: 'sm', iconName: 'check', onClick: () => setAllChecked(true) }),
          button({ label: '清空', variant: 'ghost', size: 'sm', iconName: 'x', onClick: () => setAllChecked(false) }))),
    );

    const listRoot = checklistSlot.firstElementChild;
    for (const [category, items] of groups) {
      const groupCount = h('span', { class: 'checklist__group-count t-num' });
      groupCounts.set(category, groupCount);
      const itemsNode = h('div', { class: 'checklist__items' });
      const wrap = h('section', { class: 'checklist__group' },
        h('div', { class: 'checklist__group-head' },
          h('span', { class: 'checklist__group-title', text: category }),
          groupCount,
          h('span', { class: 'checklist__rule', attrs: { 'aria-hidden': 'true' } })),
        itemsNode);
      for (const item of items) {
        const node = checkbox({
          name: `chk-${item.id}`,
          label: item.item,
          description: item.standard,
          checked: checked.has(item.id),
          onChange: (on) => { if (on) checked.add(item.id); else checked.delete(item.id); refreshCounter(); },
        });
        node.classList.add('check--review');
        // 状态标签常驻 DOM（占位不跳动），样式的 opacity 负责显隐。
        node.append(h('span', { class: 'check__tag', attrs: { 'aria-hidden': 'true' }, text: '已确认' }));
        checkNodes.push({ id: item.id, node, input: node.control });
        itemsNode.append(node);
      }
      listRoot.append(wrap);
    }
    refreshCounter();
  }

  /** 批量勾选 / 清空：同步 Set、原生 checkbox 与 data-checked（视觉由 CSS 驱动）。 */
  function setAllChecked(on) {
    for (const entry of checkNodes) {
      if (on) checked.add(entry.id); else checked.delete(entry.id);
      entry.input.checked = on;
      entry.node.dataset.checked = String(on);
    }
    refreshCounter();
  }

  /* ---- 渲染：修改意见行 ---- */
  function renderOpinions() {
    clear(opinionsSlot);
    opinionsSlot.append(h('p', { class: 't-label', text: '修改意见（选填，逐条填写；会写入《审核意见》Word 的意见表）' }));
    opinions.forEach((row, index) => {
      const pos = field({ label: '位置', name: `pos-${index}`, placeholder: '如：第 3 段 / 封面图', value: row.position });
      const problem = field({ label: '问题描述', name: `pb-${index}`, placeholder: '如：数据与活动记录不一致', value: row.problem });
      const req = field({ label: '修改要求', name: `rq-${index}`, placeholder: '如：改为 120 人，并补一句说明', value: row.requirement });
      pos.control.addEventListener('input', () => { row.position = pos.control.value; });
      problem.control.addEventListener('input', () => { row.problem = problem.control.value; });
      req.control.addEventListener('input', () => { row.requirement = req.control.value; });
      opinionsSlot.append(
        h('div', { class: 'stack-2' },
          h('div', { class: 'row-2 row-between' }, h('span', { class: 't-caption t-faint', text: `意见 ${index + 1}` }),
            button({ label: '删除', variant: 'ghost', size: 'sm', iconName: 'x', onClick: () => { opinions.splice(index, 1); renderOpinions(); } })),
          pos, problem, req),
      );
    });
    opinionsSlot.append(button({
      label: '添加一条意见', variant: 'secondary', size: 'sm', iconName: 'plus',
      onClick: () => { opinions.push({ position: '', problem: '', requirement: '' }); renderOpinions(); },
    }));
  }

  /* ---- 渲染：审核链 + 责任人 ---- */
  function renderChain() {
    clear(chainSlot);
    if (!chain) return;
    // 服务端 reviewChainView 返回 steps（含 done/returnRounds）；旧字段名 chain 仅作兜底。
    const nodes = Array.isArray(chain.steps) ? chain.steps : (Array.isArray(chain.chain) ? chain.chain : []);
    const steps = h('div', { class: 'row-wrap row-2' });
    nodes.forEach((node) => {
      const passed = Boolean(node.done) || node.level <= chain.passed;
      const current = node.level === (chain.current?.level || 0);
      steps.append(badge(`${node.level}. ${node.name}`, {
        tone: passed ? 'success' : current ? 'warning' : 'neutral',
        iconName: passed ? 'check' : current ? 'clock' : null,
      }));
    });
    chainSlot.append(
      h('p', { class: 't-label', text: `${chain.kindLabel || '审核链'}（${chain.passed}/${chain.total} 级已完成）` }),
      steps,
      chain.done
        ? notice('已完成全部审核，可以创建排期任务。', { tone: 'success', iconName: 'check' })
        : notice(`当前待「${chain.current?.name || '—'}」处理。`, { tone: 'info', iconName: 'info' }),
    );
  }

  async function loadAssignees(category) {
    clear(assigneeSlot);
    assigneeSlot.append(skeletonLine('sk-w-70'), skeletonLine('sk-w-50'));
    try {
      const payload = await consoleApi.outreach.assignees(category);
      clear(assigneeSlot);
      assigneeSlot.append(
        h('p', { class: 't-label', text: '本次审核责任人（按栏目自动匹配）' }),
        definitionList([
          ['对接人（初审）', payload.liaison?.name ? `${payload.liaison.name}${payload.liaison.email ? ` · ${payload.liaison.email}` : ' · 邮箱未配置'}` : '未配置，暂停审核'],
          ['审核人（终审）', payload.reviewer?.name ? `${payload.reviewer.name}${payload.reviewer.email ? ` · ${payload.reviewer.email}` : ' · 邮箱未配置'}` : '未配置，暂停审核'],
        ]),
      );
    } catch (error) {
      clear(assigneeSlot);
      assigneeSlot.append(h('p', { class: 't-caption t-faint', text: error?.message || '责任人加载失败' }));
    }
  }

  const preview = h('section', { class: 'review-preview stack-4' }, h('h2', { class: 't-h3', text: '作品与来源' }), meta,
    h('div', { class: 'content-preview t-secondary', text: content || '（无正文）' }), attachments);
  const decisions = h('section', { class: 'review-decisions stack-4' }, h('h2', { class: 't-h3', text: '审核与处理' }));
  if (reviewFlow) decisions.append(chainSlot, field({ label: '当前投稿栏目', name: 'category', value: reviewFlow.category || '未配置', readonly: true }), assigneeSlot);
  decisions.append(reviewFormBlock, h('div', { class: 'field' }, h('p', { class: 'field__label', text: '最终决策' }), decisionControl, hintNode), noteField);
  const body = h('div', { class: 'review-workspace' }, preview, decisions);

  const submitButton = button({ label: '提交审核结果', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow,
    title,
    width: 1120,
    workspace: true,
    body,
    footer: [
      reviewFlow && reviewFlow.isSubmission !== false
        ? button({
            label: '生成意见 Word', variant: 'secondary', iconName: 'download',
            onClick: () => downloadOpinion(),
          })
        : null,
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ].filter(Boolean),
  });

  const draftProtection = protectDrawerDraft(drawer, {
    readFields: () => [{ note: noteField.control.value }],
    readExtraState: () => ({
      decision,
      checked: [...checked].sort(),
      opinions: opinions.map((row) => ({
        position: row.position,
        problem: row.problem,
        requirement: row.requirement,
      })),
    }),
    isBusy: () => submitting,
  });

  async function downloadOpinion() {
    if (!reviewFlow) return;
    const payload = {
      level: chain?.current?.level || chain?.total || 1,
      levelName: chain?.current?.name || '',
      decision,
      note: noteField.control.value.trim(),
      checklist: checklist.filter((item) => checked.has(item.id)),
      opinions: opinions.filter((row) => row.position || row.problem || row.requirement),
    };
    try {
      // 走 consoleApi.outreach.opinion（内部 requestBlob）：自动注入会话 CSRF，
      // 403 时自动刷新会话重试一次。不可用裸 fetch 读 meta[name="csrf-token"]。
      const { blob, disposition } = await consoleApi.outreach.opinion(reviewFlow.contentId, payload);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = opinionFilename(disposition, `审核意见-${title}.docx`);
      link.click();
      URL.revokeObjectURL(link.href);
      notify.success('审核意见已下载', '可直接回传给投稿人。');
    } catch (error) {
      reportError(error, '意见 Word 未生成');
    }
  }

  async function submit() {
    if (submitting) return;
    noteField.setError(null);
    checklistError.hidden = true;
    const note = noteField.control.value.trim();
    if (reviewFlow && (!chain || (decision === 'approve' && !checklist.length))) {
      checklistError.hidden = false;
      checklistError.replaceChildren(h('span', { text: '审核链或检查清单尚未就绪，请刷新或联系管理员配置。' }));
      return;
    }
    // 清单必填：通过（approve）时须逐项确认全部检查项（勾 = 该项已确认合格）。
    if (decision === 'approve' && reviewFlow && checklist.length) {
      const missing = checklist.filter((item) => !checked.has(item.id));
      if (missing.length) {
        checklistError.hidden = false;
        checklistError.replaceChildren(
          icon('alert', 'ico ico--sm'),
          h('span', { text: `还有 ${missing.length} 项未确认合格（如「${missing[0].item}」）。请逐项打勾确认，或改选「退回修改」。` }),
        );
        shake(checklistSlot);
        return;
      }
    }
    if (decision === 'return' && !note) {
      noteField.setError('退回修改必须填写审核意见');
      shake(noteField);
      return;
    }
    if (decision === 'return' && chain && !chain.canReturn) {
      noteField.setError('当前级别已经退回修改过一次，请先修改后重新提交');
      shake(noteField);
      return;
    }
    submitting = true;
    try {
      const payload = await runWithLoading(submitButton, () =>
        onSubmit({
          decision, note, expectedLevel: chain?.current?.level,
          checklists: checklist.filter((item) => checked.has(item.id)),
          opinions: opinions.filter((row) => row.position || row.problem || row.requirement),
        }),
      );
      draftProtection.release();
      notify.success(decision === 'approve' ? '已审核通过' : '已退回修改', payload?.message || title);
      drawer.close();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.isConflict)) {
        noteField.setError(error.message);
        shake(noteField);
        return;
      }
      reportError(error, '审核未完成');
    } finally {
      submitting = false;
    }
  }

  /* ---- 初始化 v3 数据 ---- */
  if (reviewFlow) {
    setDecision('approve');
    renderOpinions();
    consoleApi.outreach.reviewChain(reviewFlow.contentId)
      .then((payload) => {
        chain = payload.chain;
        reviewFlow.category = reviewFlow.category || chain.category;
        renderChain();
        loadAssignees(reviewFlow.category);
      })
      .catch((error) => {
        clear(chainSlot);
        chainSlot.append(h('p', { class: 't-caption t-faint', text: error?.message || '审核链加载失败' }));
      });
    consoleApi.outreach.checklist()
      .then((payload) => { checklist = payload.checklist || []; renderChecklist(); })
      .catch(() => {});
  }
}

/* --------------------------------------------------------------------------
   Submission attachments — lazily loaded review section
   -------------------------------------------------------------------------- */
function submissionAttachmentsSection(submission) {
  const slot = h('div', { class: 'stack-2' });
  const section = h(
    'div',
    { class: 'stack-3' },
    h('p', { class: 't-label', text: `附件（${submission.attachmentCount ?? 0}）` }),
    slot,
  );

  const kindIcon = (mimeType) => (/^image\//.test(mimeType || '') ? 'image' : /^video\//.test(mimeType || '') ? 'camera' : 'file');

  function renderRows(payload) {
    clear(slot);
    const records = payload.attachments || [];
    if (!records.length) {
      slot.append(notice('这篇投稿没有附件。', { tone: 'neutral', iconName: 'inbox' }));
      return;
    }
    if (!payload.storageConfigured) {
      slot.append(notice('对象存储未配置，下载链接暂不可用；文件名、校验与上传记录仍可核对。', { tone: 'warning' }));
    }
    const list = h('div', { class: 'attach-list' });
    for (const record of records) {
      const link = payload.links?.[record.id] || '';
      const isImage = /^image\//.test(record.mimeType || '');
      list.append(
        h(
          'div',
          { class: 'attach-list__row' },
          h('span', { class: 'attach-list__icon' }, icon(kindIcon(record.mimeType), 'ico ico--sm')),
          h(
            'div',
            { class: 'attach-list__body' },
            h('span', { class: 'attach-list__name', text: record.filename }),
            h('span', { class: 'attach-list__meta t-caption t-faint', text: `${record.mimeType || '未知类型'} · ${fmt.bytes(record.size)} · 上传于 ${fmt.fullDateTime(record.uploadedAt)}` }),
            record.checksum ? h('span', { class: 'attach-list__meta attach-list__meta--mono t-caption t-faint', text: `SHA-256 ${String(record.checksum).slice(0, 16)}…` }) : null,
          ),
          h(
            'div',
            { class: 'row-2' },
            isImage && link ? button({ label: '预览', variant: 'ghost', size: 'sm', iconName: 'eye', onClick: () => openLightbox({ src: link, caption: record.filename }) }) : null,
            link ? button({ label: '下载', variant: 'secondary', size: 'sm', iconName: 'download', onClick: () => window.open(link, '_blank', 'noopener') }) : null,
          ),
        ),
      );
    }
    slot.append(list);
  }

  function renderError(error) {
    clear(slot);
    slot.append(
      h('div', { class: 'stack-2' },
        h('p', { class: 't-caption', text: error?.message || '附件加载失败。' }),
        button({ label: '重试', variant: 'secondary', size: 'sm', iconName: 'refresh', iconMotion: 'spin', onClick: load })));
  }

  async function load() {
    clear(slot);
    slot.append(skeletonLine('sk-w-85'), skeletonLine('sk-w-55'));
    try {
      renderRows(await consoleApi.outreach.submissionAttachments(submission.id));
    } catch (error) {
      renderError(error);
    }
  }

  load();
  return section;
}

/* --------------------------------------------------------------------------
   Schedule + result drawers
   -------------------------------------------------------------------------- */
function openScheduleDrawer(item, { onDone }) {
  let submitting = false;
  const channelField = field({ label: '发布渠道', name: 'channel', options: CHANNELS, value: 'site' });
  // v3 / N3：发布形式必选（大推文 / 小绿书）。
  let publishForm = item.publishForm || '大推文';
  const publishFormControl = segmented({
    items: [
      { value: '大推文', label: '大推文' },
      { value: '小绿书', label: '小绿书' },
    ],
    value: publishForm,
    ariaLabel: '发布形式',
    onChange: (value) => { publishForm = value; publishFormControl.setValue(value); hintNode.textContent = formHint(value); },
  });
  const hintNode = h('p', { class: 't-caption', text: formHint(publishForm) });
  function formHint(value) {
    return value === '小绿书'
      ? '小绿书走「对接人初审 → 审核人终审」两级审核，篇幅短、以图文卡片为主。'
      : '大推文走常规两级审核，正文与排版完整。发布形式会写入任务，便于统计。';
  }
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
    body: [
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '发布形式（必选）' }), publishFormControl, hintNode),
      h('div', { class: 'formgrid' }, channelField, plannedField),
      noteField,
      confirmManual,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  const draftProtection = protectDrawerDraft(drawer, {
    readExtraState: () => ({ publishForm }),
    isBusy: () => submitting,
  });

  async function submit() {
    if (submitting) return;
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
    submitting = true;
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.outreach.schedule(item.id, {
          channel: channelField.control.value,
          publishForm,
          plannedAt: new Date(plannedField.control.value).toISOString(),
          note: noteField.control.value.trim(),
        }),
      );
      draftProtection.release();
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
    } finally {
      submitting = false;
    }
  }
}

function openResultDrawer(item, { onDone }) {
  let submitting = false;
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
      notice('发布失败时，可重新登记发布结果。', { tone: 'warning' }),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  const draftProtection = protectDrawerDraft(drawer, {
    readExtraState: () => ({ status }),
    isBusy: () => submitting,
  });

  async function submit() {
    if (submitting) return;
    reasonField.setError(null);
    if (status === 'failed' && !reasonField.control.value.trim()) {
      reasonField.setError('发布失败必须填写原因');
      shake(reasonField);
      return;
    }
    submitting = true;
    try {
      const payload = await runWithLoading(submitButton, () =>
        consoleApi.outreach.result(item.id, {
          status,
          publishedLink: linkField.control.value.trim(),
          failureReason: reasonField.control.value.trim(),
        }),
      );
      draftProtection.release();
      notify.success('结果已登记', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '结果未登记');
    } finally {
      submitting = false;
    }
  }
}

/* --------------------------------------------------------------------------
   Page
   -------------------------------------------------------------------------- */
export default async function outreachPage(context, shell) {
  let tab = context.query.get('tab') || 'board';
  let presentation = 'list', stage = 'all';
  let submissionTargetHandled = false;
  let campaignTargetHandled = false;
  let disposed = false;
  const bodySlot = h('div', { class: 'stack-6' });

  const tabControl = segmented({
    items: [
      { value: 'board', label: '内容看板' },
      { value: 'public', label: '公众投稿' },
      { value: 'tasks', label: '发布任务' },
      { value: 'media', label: '影像审核' },
      { value: 'skills', label: '技能审核' },
      { value: 'claims', label: '任务审核' },
      { value: 'showcase', label: '宣传展示' },
      { value: 'schema', label: '数据结构' },
    ],
    value: tab,
    ariaLabel: '宣传管理视图',
    onChange: (value) => {
      tab = value;
      submissionTargetHandled = true;
      campaignTargetHandled = true;
      patchQuery({
        tab: value,
        submission: null,
        campaign: null,
      });
      tabControl.setValue(value);
      renderTab();
    },
  });

  /* ---- Board ------------------------------------------------------------ */
  const boardRegion = asyncRegion({
    lazy: true,
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
            isLegacySource(item)
              ? notice('此条目来自历史来源（策划案 / 纪念品大赛），未纳入 v3 多级审核，因此不提供审核入口。', { tone: 'info', iconName: 'info' })
              : button({
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
                      reviewFlow: { contentId: item.id, category: item.type, kind: item.kind },
                      onSubmit: async ({ decision, note, checklists, opinions, expectedLevel }) => {
                        const result = await consoleApi.outreach.reviewStep(item.id, {
                          decision, note, expectedLevel,
                          opinions: opinions?.map((row) => ({ position: row.position, problem: row.problem, requirement: row.requirement, fixed: false })) || [],
                          checklist: checklists?.map((row) => ({ id: row.id, category: row.category, item: row.item, standard: row.standard, checked: true })) || [],
                        });
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

      if (
        !disposed &&
        tab === 'board' &&
        !campaignTargetHandled &&
        context.query.has('campaign')
      ) {
        campaignTargetHandled = true;
        const id = context.query.get('campaign');
        const target = id?.trim()
          ? payload.campaigns.find((item) => item.id === id)
          : null;

        if (target) {
          showInspector(target);
        } else {
          notify.warning(
            '当前看板未找到对应内容',
            '记录可能已变化，或你暂时没有查看权限。',
          );
        }
      }

      const stageOf = item => BOARD_COLUMNS.find(column => column.match(item));
      const contentSlot = h('div');
      const stageControl = segmented({
        items: [{ value: 'all', label: `全部 ${payload.campaigns.length}` }, ...BOARD_COLUMNS.map(column => ({ value: column.key, label: `${column.label} ${payload.campaigns.filter(column.match).length}` }))],
        value: stage, role: 'radiogroup', ariaLabel: '内容阶段',
        onChange: value => { stage = value; stageControl.setValue(value); draw(); },
      });
      const viewControl = segmented({ items: [{ value: 'list', label: '任务列表' }, { value: 'board', label: '阶段看板' }], value: presentation, role: 'radiogroup', ariaLabel: '内容呈现', onChange: value => { presentation = value; viewControl.setValue(value); draw(); } });
      function draw() {
        clear(contentSlot);
        const rows = payload.campaigns.filter(item => stage === 'all' || stageOf(item)?.key === stage);
        if (presentation === 'list') {
          contentSlot.append(dataTable({ rows, getKey: item => item.id, searchPlaceholder: '搜索标题、投稿人或栏目', searchKeys: ['title','author','type'],
            columns: [
              { key: 'title', label: '内容', strong: true, render: item => h('span', { class: 't-clamp-2', text: item.title }) },
              { key: 'author', label: '投稿人' }, { key: 'type', label: '栏目' },
              { key: 'status', label: '阶段', value: item => stageOf(item)?.label || item.status, render: item => badge(stageOf(item)?.label || item.status, { tone: stageOf(item)?.tone || 'neutral' }) },
              { key: 'submittedAt', label: '提交时间', render: item => h('span', { text: fmt.fullDateTime(item.submittedAt) }) },
            ], onRowClick: showInspector, buildRowAction: item => button({ label: '查看内容', variant: 'secondary', size: 'sm', onClick: () => showInspector(item) }),
          }));
          return;
        }
        const board = h('div', { class: 'board board--adaptive' });
        for (const column of BOARD_COLUMNS) {
          const items = rows.filter(column.match);
          if (!items.length) continue; // Counts above retain every empty stage.
          board.append(h('section', { class: 'board__col' }, h('header', { class: 'board__head' }, h('h2', { class: 't-label', text: column.label }), badge(String(items.length), { tone: column.tone })),
            h('div', { class: 'board__items' }, ...items.map(item => h('button', { class: 'board__card', type: 'button', on: { click: () => showInspector(item) } }, h('b', { text: item.title }), h('span', { class: 't-caption', text: `${item.author} · ${item.type}` }), h('span', { class: 't-caption t-clamp-2', text: item.summary || '暂无摘要' }))))));
        }
        contentSlot.append(rows.length ? board : emptyState({ title: '这一阶段没有内容', iconName: 'check', description: '选择其他阶段继续查看。' }));
      }
      draw();
      const workspace = h('div', { class: 'operations-content' }, h('div', { class: 'operations-toolbar' }, viewControl), stageControl, contentSlot);

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
          ? workspace
          : emptyState({
              iconName: 'megaphone',
              title: '还没有可审核的内容资产',
              description: '策划案与文创征集会自动汇总到这里。公众端的新投稿会出现在「公众投稿」标签下。',
            }),
      ];
    },
  });

  /* ---- Public submissions ----------------------------------------------- */
  const publicRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(6),
    errorTitle: '公众投稿无法加载',
    load: () => consoleApi.outreach.publicSubmissions(),
    render: (payload, { reload }) => {
      const openPublicReview = (row) =>
        openReviewDrawer({
          eyebrow: `公众投稿 · ${row.category}`,
          title: row.title,
          meta: definitionList([
            ['投稿编号', copyableCode(row.id)],
            ['署名方式', row.signature],
            ['联系人', `${row.contact} · ${row.contactEmail}`],
            ['肖像授权', row.portraitConfirm ? '已确认' : '未涉及/未确认'],
            ['附件', row.attachmentCount ? `${row.attachmentCount} 个（见下方附件区）` : '无'],
            ['提交时间', fmt.fullDateTime(row.submittedAt)],
            ['当前状态', row.status],
          ]),
          content: row.content,
          attachments: submissionAttachmentsSection(row),
          reviewFlow: {
            contentId: row.id,
            category: row.articleCategory || row.category,
          },
          onSubmit: async ({
            decision, note, checklists, opinions, expectedLevel,
          }) => {
            const result = await consoleApi.outreach.reviewStep(row.id, {
              decision,
              note,
              expectedLevel,
              opinions: opinions?.map((entry) => ({
                position: entry.position,
                problem: entry.problem,
                requirement: entry.requirement,
                fixed: false,
              })) || [],
              checklist: checklists?.map((entry) => ({
                id: entry.id,
                category: entry.category,
                item: entry.item,
                standard: entry.standard,
                checked: true,
              })) || [],
            });
            reload();
            shell.refreshTodos();
            return result;
          },
        });

      let targetNotice = null;
      if (
        !disposed &&
        tab === 'public' &&
        !submissionTargetHandled &&
        context.query.has('submission')
      ) {
        submissionTargetHandled = true;
        const id = context.query.get('submission');
        const target = id?.trim()
          ? payload.submissions.find((row) => row.id === id)
          : null;

        if (target) {
          openPublicReview(target);
        } else {
          targetNotice = notice(
            '当前投稿列表中没有找到这条记录。记录可能已变化，或你暂时没有查看权限。',
            { tone: 'info', iconName: 'info' },
          );
        }
      }

      if (!payload.submissions.length) {
        return [
          targetNotice,
          emptyState({
            iconName: 'inbox',
            title: '还没有来自公众端的投稿',
            description: '同学在公众端「内容投稿」提交后会立即进入这个队列，并在通知中心标记为高优先级。',
            actions: [
              button({
                label: '查看公众端投稿页',
                variant: 'secondary',
                iconAfter: 'external',
                href: '/submit',
                data: { native: 'true' },
              }),
            ],
          }),
        ];
      }

      return [
        targetNotice,
        dataTable({
          columns: [
            { key: 'title', label: '标题', strong: true },
            { key: 'category', label: '类型' },
            { key: 'signature', label: '署名' },
            { key: 'contact', label: '联系人' },
            {
              key: 'status',
              label: '状态',
              render: (row) => statusFor(row.status),
            },
            {
              key: 'submittedAt',
              label: '提交时间',
              render: (row) => fmt.fullDateTime(row.submittedAt),
            },
          ],
          ...tableStateOptions({
            prefix: 'publicSubmissions',
            sortKeys: [
              'title',
              'category',
              'signature',
              'contact',
              'status',
              'submittedAt',
            ],
            clearTargets: ['submission', 'campaign'],
          }),
          rows: payload.submissions,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索标题、类型或正文',
          searchKeys: ['title', 'category', 'excerpt'],
          countLabel: (n) => `${n} 篇投稿`,
          onRowClick: openPublicReview,
          buildRowMenu: (row) => [
            {
              label: '审核这篇投稿',
              iconName: 'eye',
              onSelect: () => openPublicReview(row),
            },
            {
              label: '复制投稿编号',
              iconName: 'copy',
              onSelect: () => navigator.clipboard?.writeText(row.id),
            },
          ],
        }),
      ];
    },
  });

  /* ---- Publication tasks ------------------------------------------------ */
  const tasksRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(5),
    errorTitle: '发布任务无法加载',
    load: () => consoleApi.outreach.overview(),
    render: (payload, { reload }) => {
      const tasks = payload.campaigns.filter((item) => item.publication);
      if (!tasks.length) {
        return emptyState({
          iconName: 'send',
          title: '还没有发布任务',
          description: '为审核通过的内容安排渠道和发布时间。',
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
    lazy: true,
    skeleton: skeletonRows(4),
    errorTitle: '结构预览无法加载',
    load: () => consoleApi.outreach.schemaPreview(),
    render: (payload) => [
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

  /* ---- 技能审核（v3 S5）：技能提交 → 管理员定星 → 写回账号星级 --------- */
  /* v3 S7（N2）：宣传展示维护（公众号文章半自动导入 + 展示墙条目管理）。
     页面本体复用 console/pages/showcase.js，既可在本页签内使用，也可经
     /console/showcase 独立打开（导航高亮同样归到「宣传管理」）。 */
  const showcaseRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(3), skeletonRows(6)),
    errorTitle: '宣传展示维护页无法加载',
    load: async () => (await showcaseAdminPage(context, shell)).node,
    render: (node) => [node],
  });

  const skillsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(2), skeletonRows(5)),
    errorTitle: '技能审核队列无法加载',
    load: () => consoleApi.skills.queue(),
    render: (payload, { reload }) => {
      const queue = payload.queue || [];
      const reviewed = payload.reviewed || [];
      const submitReview = async (skill, decision, level, node) => {
        if (decision === 'reject') {
          const note = window.prompt(`驳回技能「${skill.name}」，请写明原因：`, '');
          if (note === null) return;
          if (!note.trim()) { notify.warning('需要填写驳回原因', skill.name); return; }
          try {
            const run = () => consoleApi.skills.review(skill.id, { decision: 'reject', note: note.trim() });
            const res = node ? await runWithLoading(node, run) : await run();
            notify.success('已驳回', res.message || skill.name);
            reload();
          } catch (error) {
            if (error instanceof ApiError) notify.warning('审核未生效', error.message);
            else reportError(error, '技能审核失败');
          }
          return;
        }
        // 通过：确认最终星级（默认取自评）
        const input = window.prompt(`通过技能「${skill.name}」，确认最终星级（1-5，自评 ${skill.selfStars} 星）：`, String(skill.selfStars || 3));
        if (input === null) return;
        const finalLevel = Number(input);
        if (!(finalLevel >= 1 && finalLevel <= 5)) { notify.warning('星级无效', '请输入 1-5 之间的整数。'); return; }
        try {
          const run = () => consoleApi.skills.review(skill.id, { decision: 'approve', level: finalLevel });
          const res = node ? await runWithLoading(node, run) : await run();
          notify.success('已通过', res.message || `${skill.name} → ${finalLevel} 星`);
          reload();
        } catch (error) {
          if (error instanceof ApiError) notify.warning('审核未生效', error.message);
          else reportError(error, '技能审核失败');
        }
      };

      return h('div', { class: 'stack-7' },
        h('div', { class: 'stack-4' },
          h('div', { class: 'row-3 row-wrap' },
            h('p', { class: 't-h3', text: '技能待审核' }),
            badge(`${queue.length} 条待审核`, { tone: queue.length ? 'warning' : 'neutral', iconName: 'star' })),
          h('p', { class: 't-caption t-faint', text: '成员在会员中心提交技能（说明必填）。通过时确认最终星级，系统会把该账号的技能星级更新为其已通过技能的最高星。' }),
          queue.length
            ? dataTable({
              columns: [
                { key: 'name', label: '技能', strong: true, render: (row) => h('span', { class: 't-body', text: row.name }) },
                { key: 'softwares', label: '常用软件', sortable: false, render: (row) => h('span', { class: 't-caption', text: (row.softwares || []).join('、') || '—' }) },
                { key: 'account', label: '提交人' },
                { key: 'selfStars', label: '自评星级', sortable: false, render: (row) => badge(`${row.selfStars} 星`, { tone: 'neutral', iconName: 'star' }) },
                { key: 'description', label: '说明', sortable: false, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.description }) },
                { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.fullDateTime(row.submittedAt) }) },
              ],
              rows: queue,
              getKey: (row) => row.id,
              searchPlaceholder: '搜索技能或提交人',
              countLabel: (n) => `${n} 条待审核`,
              onRowClick: (row) => shell.openInspector({
                eyebrow: '技能审核',
                title: row.name,
                subtitle: row.account || '—',
                body: [definitionList([
                  ['自评星级', `${row.selfStars} 星`],
                  ['常用软件', (row.softwares || []).join('、') || '（未填）'],
                  ['提交时间', fmt.fullDateTime(row.submittedAt)],
                  ['往期作品链接', row.proof ? copyableCode(row.proof) : '（未提供）'],
                  ['技能说明', row.description],
                ])],
                footer: [
                  button({ label: '驳回', variant: 'secondary', size: 'sm', onClick: () => submitReview(row, 'reject') }),
                  button({ label: '通过并定星', variant: 'primary', size: 'sm', onClick: () => submitReview(row, 'approve') }),
                ],
              }),
            })
            : emptyState({ iconName: 'star', title: '没有待审核的技能', description: '成员在会员中心提交技能后会出现在这里。' })),
        h('hr', { class: 'divider' }),
        h('div', { class: 'stack-4' },
          h('p', { class: 't-h3', text: `已审核（${reviewed.length}）` }),
          reviewed.length
            ? dataTable({
              columns: [
                { key: 'name', label: '技能' },
                { key: 'softwares', label: '常用软件', sortable: false, render: (row) => h('span', { class: 't-caption', text: (row.softwares || []).join('、') || '—' }) },
                { key: 'account', label: '提交人' },
                { key: 'selfStars', label: '最终星级', sortable: false, render: (row) => badge(`${row.selfStars} 星`, { tone: 'accent', iconName: 'star' }) },
                { key: 'status', label: '结论', sortable: false, render: (row) => statusFor(row.status) },
                { key: 'reviewNote', label: '审核意见', sortable: false, render: (row) => h('span', { class: 't-caption', text: row.reviewNote || '—' }) },
              ],
              rows: reviewed,
              getKey: (row) => row.id,
              searchPlaceholder: '搜索已审核技能',
              countLabel: (n) => `${n} 条记录`,
            })
            : notice('还没有审核记录。', { tone: 'neutral', iconName: 'info' })));
    },
  });

  /* ---- 任务申领审核（v3.1）：管理员审核申领 → 通过才真正认领 ---------- */
  const claimsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(2), skeletonRows(5)),
    errorTitle: '任务申领队列无法加载',
    load: () => consoleApi.tasks.claims(),
    render: (payload, { reload }) => {
      const pending = payload.pending || [];
      const reviewed = payload.reviewed || [];
      const submitReview = async (claim, decision, node) => {
        let note = '';
        if (decision === 'reject') {
          const input = window.prompt(`驳回「${claim.claimant}」对任务「${claim.task?.title || claim.taskId}」的申领，请写明原因：`, '');
          if (input === null) return;
          if (!input.trim()) { notify.warning('需要填写驳回原因', claim.claimant); return; }
          note = input.trim();
        }
        try {
          const run = () => consoleApi.tasks.reviewClaim(claim.id, { decision, note });
          const res = node ? await runWithLoading(node, run) : await run();
          notify.success(decision === 'approve' ? '已通过' : '已驳回', res.message || claim.claimant);
          reload();
        } catch (error) {
          if (error instanceof ApiError) notify.warning('审核未生效', error.message);
          else reportError(error, '申领审核失败');
        }
      };

      return h('div', { class: 'stack-7' },
        h('div', { class: 'stack-4' },
          h('div', { class: 'row-3 row-wrap' },
            h('p', { class: 't-h3', text: '待审核的申领' }),
            badge(`${pending.length} 条待审核`, { tone: pending.length ? 'warning' : 'neutral', iconName: 'inbox' })),
          h('p', { class: 't-caption t-faint', text: '成员提交申领后不会立即接单：管理员在这里审核，通过后任务才分配给该成员，驳回则任务重新开放申领。' }),
          pending.length
            ? dataTable({
              columns: [
                { key: 'task', label: '任务', strong: true, value: (row) => row.task?.title || row.taskId, render: (row) => h('span', { class: 't-body', text: row.task?.title || '（任务已删除）' }) },
                { key: 'claimant', label: '申领人' },
                { key: 'skill', label: '技能要求', sortable: false, value: (row) => row.task?.skillRequirement || '', render: (row) => h('span', { class: 't-caption', text: row.task?.skillRequirement ? `${row.task.skillRequirement}${row.task.skillStars ? ` · ${row.task.skillStars} 星` : ''}` : '—' }) },
                { key: 'at', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.fullDateTime(row.at) }) },
              ],
              rows: pending,
              getKey: (row) => row.id,
              searchPlaceholder: '搜索任务或申领人',
              countLabel: (n) => `${n} 条待审核`,
              onRowClick: (row) => shell.openInspector({
                eyebrow: '任务申领审核',
                title: row.task?.title || '（任务已删除）',
                subtitle: `申领人：${row.claimant}`,
                body: [definitionList([
                  ['任务状态', row.task?.status || '—'],
                  ['技能要求', row.task?.skillRequirement ? `${row.task.skillRequirement}${row.task.skillStars ? ` · ${row.task.skillStars} 星` : ''}` : '—'],
                  ['申领留言', row.note || '（无）'],
                  ['提交时间', fmt.fullDateTime(row.at)],
                ])],
                footer: [
                  button({ label: '驳回', variant: 'secondary', size: 'sm', onClick: () => submitReview(row, 'reject') }),
                  button({ label: '通过并分配', variant: 'primary', size: 'sm', onClick: () => submitReview(row, 'approve') }),
                ],
              }),
            })
            : emptyState({ iconName: 'inbox', title: '没有待审核的申领', description: '成员在心愿清单提交申领后会出现在这里。' })),
        h('hr', { class: 'divider' }),
        h('div', { class: 'stack-4' },
          h('p', { class: 't-h3', text: `已处理（${reviewed.length}）` }),
          reviewed.length
            ? dataTable({
              columns: [
                { key: 'task', label: '任务', value: (row) => row.task?.title || row.taskId, render: (row) => h('span', { class: 't-body', text: row.task?.title || '（任务已删除）' }) },
                { key: 'claimant', label: '申领人' },
                { key: 'status', label: '结论', sortable: false, render: (row) => statusFor(row.status) },
                { key: 'reviewer', label: '审核人', sortable: false },
                { key: 'reviewNote', label: '审核意见', sortable: false, render: (row) => h('span', { class: 't-caption', text: row.reviewNote || '—' }) },
              ],
              rows: reviewed,
              getKey: (row) => row.id,
              searchPlaceholder: '搜索任务或申领人',
              countLabel: (n) => `${n} 条记录`,
            })
            : notice('还没有审核记录。', { tone: 'neutral', iconName: 'info' })));
    },
  });

  /* ---- 影像审核（v3 N1）：精选确认队列 + 删除审核队列 ------------------- */
  const mediaRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(3), skeletonRows(5)),
    errorTitle: '影像审核队列无法加载',
    load: async () => {
      const [picks, deletes] = await Promise.all([
        consoleApi.media.picksQueue().catch((error) => ({ ok: false, error, queue: [] })),
        consoleApi.media.deleteQueue().catch((error) => ({ ok: false, error, queue: [] })),
      ]);
      return { picks, deletes };
    },
    render: ({ picks, deletes }, { reload }) => {
      const pickQueue = picks?.queue || [];
      const deleteQueue = deletes?.queue || [];

      /** 精选确认：逐张复制到精选库，原库不删；失败自动回退状态。 */
      const confirmPicks = async (ids, node = null) => {
        if (!ids.length) { notify.info('先勾选照片', '勾选「已申请待确认」的照片后再点确认。'); return; }
        if (!window.confirm(`确认把 ${ids.length} 张照片复制到精选库（南大红会图片素材库）？\n\n主库原件与路径保持不变。`)) return;
        try {
          const run = () => consoleApi.media.pickConfirm(ids);
          const payload = node ? await runWithLoading(node, run) : await run();
          const failed = payload.failed || [];
          if (failed.length) notify.warning('部分未确认', failed.map((item) => `${item.filename}：${item.reason}`).join('；'));
          notify.success('精选确认完成', payload.message || `已确认 ${payload.confirmed?.length || 0} 张。`);
          reload();
        } catch (error) {
          if (error instanceof ApiError) notify.warning('精选确认未完成', error.message);
          else reportError(error, '精选确认失败');
        }
      };

      /** 删除审核：approve 才真删，reject 保留并记录理由。 */
      const reviewDelete = async (photoId, filename, decision, node = null) => {
        const action = decision === 'approve' ? '通过删除' : '驳回删除';
        if (!window.confirm(`确定对「${filename}」${action}？${decision === 'approve' ? '\n\n通过后云盘文件会立即删除，不可恢复。' : ''}`)) return;
        try {
          const run = () => consoleApi.media.deleteReview(photoId, decision);
          const payload = node ? await runWithLoading(node, run) : await run();
          notify.success(`已${action}`, payload.message || filename);
          reload();
        } catch (error) {
          if (error instanceof ApiError) notify.warning('审核未生效', error.message);
          else reportError(error, '删除审核失败');
        }
      };

      const pickRows = pickQueue.map((item) => ({
        id: item.id,
        photo: item,
        filename: item.filename,
        location: `${item.center || '未分类'} / ${item.activity || '未命名活动'}`,
        uploader: item.uploader || '—',
        size: fmt.bytes(item.size),
        requestedAt: fmt.fullDateTime(item.pickRequestedAt || item.uploadedAt),
        path: item.path || '—',
      }));

      const deleteRows = deleteQueue.map((item) => ({
        id: item.id,
        photo: item,
        filename: item.filename,
        location: `${item.center || '未分类'} / ${item.activity || '未命名活动'}`,
        uploader: item.uploader || '—',
        reason: item.deleteReason || '（未填写）',
        requestedAt: fmt.fullDateTime(item.deleteReviewedAt || item.uploadedAt),
        path: item.path || '—',
      }));

      const confirmAllButton = button({
        label: `全部确认（${pickQueue.length} 张）`, variant: 'primary', iconName: 'check',
        disabled: pickQueue.length === 0,
        onClick: () => confirmPicks(pickQueue.map((item) => item.id), confirmAllButton),
      });
      // 注：onClick 闭包在点击时才读 confirmAllButton，此时已赋值，无 TDZ 问题。
      const pickSection = h('div', { class: 'stack-4' },
        h('div', { class: 'row-3 row-wrap' },
          h('p', { class: 't-h3', text: '精选确认' }),
          badge(`${pickQueue.length} 张待确认`, { tone: pickQueue.length ? 'info' : 'neutral', iconName: 'star' }),
          h('span', { class: 'spacer' }),
          confirmAllButton),
        h('p', { class: 't-caption t-faint', text: '确认后照片会复制一份到精选库「南大红会图片素材库」，主库原件与路径保持不变。每批由上传人勾选 3-5 张。' }),
        pickQueue.length
          ? dataTable({
            columns: [
              { key: 'filename', label: '文件名', strong: true, render: (row) => h('span', { class: 't-body', attrs: { title: row.filename }, text: row.filename }) },
              { key: 'location', label: '归档位置' },
              { key: 'uploader', label: '上传人' },
              { key: 'size', label: '大小', sortable: false },
              { key: 'requestedAt', label: '申请时间', render: (row) => h('span', { class: 't-caption', text: row.requestedAt }) },
            ],
            rows: pickRows,
            getKey: (row) => row.id,
            searchPlaceholder: '搜索文件名或位置',
            countLabel: (n) => `${n} 张待确认`,
            onRowClick: (row) => shell.openInspector({
              eyebrow: '精选申请',
              title: row.filename,
              subtitle: row.location,
              body: [definitionList([
                ['上传人', row.uploader],
                ['大小', row.size],
                ['申请时间', row.requestedAt],
                ['主库路径', copyableCode(row.path)],
              ])],
              footer: [button({ label: '确认进入精选库', variant: 'primary', size: 'sm', onClick: () => confirmPicks([row.photo.id]) })],
            }),
          })
          : emptyState({ iconName: 'star', title: '没有待确认的精选申请', description: '成员在公众端勾选 3-5 张照片提交精选申请后，会出现在这里。' }),
      );

      const deleteSection = h('div', { class: 'stack-4' },
        h('div', { class: 'row-3 row-wrap' },
          h('p', { class: 't-h3', text: '删除审核' }),
          badge(`${deleteQueue.length} 张待审核`, { tone: deleteQueue.length ? 'warning' : 'neutral', iconName: 'trash' })),
        h('p', { class: 't-caption t-faint', text: '成员提交删除申请后，照片不会立即消失。这里通过才真正从云盘删除，驳回则原样保留。' }),
        deleteQueue.length
          ? dataTable({
            columns: [
              { key: 'filename', label: '文件名', strong: true, render: (row) => h('span', { class: 't-body', attrs: { title: row.filename }, text: row.filename }) },
              { key: 'location', label: '归档位置' },
              { key: 'uploader', label: '上传人' },
              { key: 'reason', label: '删除理由', sortable: false, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.reason }) },
              { key: 'requestedAt', label: '申请时间', render: (row) => h('span', { class: 't-caption', text: row.requestedAt }) },            ],
            rows: deleteRows,
            getKey: (row) => row.id,
            searchPlaceholder: '搜索文件名或位置',
            countLabel: (n) => `${n} 张待审核`,
            onRowClick: (row) => shell.openInspector({
              eyebrow: '删除申请',
              title: row.filename,
              subtitle: row.location,
              body: [definitionList([
                ['上传人', row.uploader],
                ['删除理由', row.reason],
                ['申请时间', row.requestedAt],
                ['云盘路径', copyableCode(row.path)],
              ])],
              footer: [
                button({ label: '驳回（保留照片）', variant: 'secondary', size: 'sm', onClick: () => reviewDelete(row.photo.id, row.filename, 'reject') }),
                button({ label: '通过并删除', variant: 'danger', size: 'sm', onClick: () => reviewDelete(row.photo.id, row.filename, 'approve') }),
              ],
            }),
          })
          : emptyState({ iconName: 'trash', title: '没有待审核的删除申请', description: '成员提交删除申请后会出现在这里，审核通过才真正删除文件。' }),
      );

      const configWarnings = [];
      if (picks?.ok === false) configWarnings.push('精选队列读取失败（可能是影像素材表未就绪或精选库未配置）。');
      if (deletes?.ok === false) configWarnings.push('删除队列读取失败。');

      return h('div', { class: 'stack-7' },
        configWarnings.length ? notice(configWarnings.join('　'), { tone: 'info', iconName: 'info' }) : null,
        pickSection,
        h('hr', { class: 'divider' }),
        deleteSection);
    },
  });

  function renderTab() {
    clear(bodySlot);
    const current = tab === 'public' ? publicRegion : tab === 'tasks' ? tasksRegion : tab === 'media' ? mediaRegion : tab === 'skills' ? skillsRegion : tab === 'claims' ? claimsRegion : tab === 'showcase' ? showcaseRegion : tab === 'schema' ? schemaRegion : boardRegion;
    current.ensureLoaded();
    bodySlot.append(
      h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), reloadAction(current, '刷新')),
      current,
    );
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide operations-module operations-outreach' },
    pageHead({
            title: '审核内容，安排发布',
      description: '征集、审核、排期与发布结果登记在一条流水线上。外部渠道仍由人工确认发布，平台负责记录与追溯。',
      actions: [button({ label: '公众端投稿页', variant: 'ghost', iconAfter: 'external', href: '/submit', data: { native: 'true' } })],
    }),
    bodySlot,
  );

  renderTab();
  return {
    title: '宣传管理',
    crumb: '宣传管理',
    node,
    dispose() {
      disposed = true;
    },
  };
}
