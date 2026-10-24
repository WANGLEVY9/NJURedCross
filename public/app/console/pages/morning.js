import { summaryMetric as metric } from '../lib.js';
/* ==========================================================================
   console/pages/morning.js — “早安晚安” member-card review.
   Registration creates a pending card; this queue is the only path that
   publishes a card to the public plaza.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { consoleApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { recordTable as dataTable } from '../lib.js';
import { asyncRegion, reloadAction } from '../lib.js';
import { communityModuleNav } from '../community-nav.js';
import { batchApprovalControls } from '../community-review-controls.js';
import {
  pageHead, metricRow, badge, button, field, notice,
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
const REVISION_STATUS = Object.freeze({
  PENDING: '待审核',
  RETURNED: '需修改',
  REJECTED: '已拒绝',
  APPROVED: '已通过',
});
const BLACKLIST_STATUS = Object.freeze({
  ACTIVE: '生效',
  RELEASED: '已解除',
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

function openMorningBlacklistDrawer(target, { source = '控制台', onDone } = {}) {
  const reasonField = field({
    label: '拉黑原因',
    name: 'morningBlacklistReason',
    multiline: true,
    rows: 4,
    maxlength: 500,
    required: true,
    placeholder: '说明拉黑依据；拉黑后现有名片会立即撤下。',
  });
  const submitButton = button({
    label: '确认拉黑',
    variant: 'danger',
    iconName: 'shield',
    onClick: () => submit(),
  });
  const drawer = openDrawer({
    placement: 'center',
    eyebrow: '早安晚安 · 成员管理',
    title: '拉黑账号',
    description: target.realName || target.nickname || target.accountId,
    width: 500,
    body: [
      definitionList([
        ['账号', target.accountId || '—'],
        ['昵称', target.nickname || '—'],
        ['真实姓名', target.realName || '—'],
        ['学号', target.studentId || '—'],
      ]),
      notice('拉黑会立即撤下该账号现有名片，并阻止其重新报名或发起邀约。', { tone: 'warning' }),
      reasonField,
    ],
    footer: [
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  async function submit() {
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason) {
      reasonField.setError('请填写拉黑原因');
      shake(reasonField);
      return;
    }
    const confirmed = await confirmAction({
      title: '确认拉黑该账号？',
      description: '该账号的现有名片会从广场撤下，之后不能重新报名或发起邀约。',
      confirmLabel: '确认拉黑',
      tone: 'danger',
      details: [`原因：${reason}`],
    });
    if (!confirmed) return;
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.morning.blacklistAccount({
        accountId: target.accountId,
        nickname: target.nickname,
        realName: target.realName,
        studentId: target.studentId,
        reason,
        source,
      }));
      notify.success('已拉黑账号', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        reasonField.setError(error.message);
        shake(reasonField);
        return;
      }
      reportError(error, '拉黑未完成');
    }
  }
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
    const blacklistButton = button({
      label: '拉黑账号',
      variant: 'danger',
      size: 'sm',
      iconName: 'shield',
      onClick: () => {
        drawer.close();
        openMorningBlacklistDrawer(card, {
          source: '审核名片',
          onDone: async () => {
            await onDone?.({ decision: 'blacklist', id: card.id });
          },
        });
      },
    });
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
        ['学院', card.department || '未填写'],
        ['年级', card.grade || '未填写'],
        ['展示学院', card.showDepartment ? '是' : '否'],
        ['展示年级', card.showGrade ? '是' : '否'],
        ['邀约邮箱', '使用账号绑定的校园邮箱'],
      ]),
    );
    const publicProjection = h(
      'div',
      { class: 'stack-3' },
      h('div', { class: 'row-3 row-wrap' },
        badge(card.campus || '未填校区', { tone: 'accent' }),
        badge(card.gender || '性别未填写', { tone: 'neutral' }),
        card.showDepartment && card.department ? badge(card.department, { tone: 'neutral' }) : null,
        card.showGrade && card.grade ? badge(card.grade, { tone: 'neutral' }) : null),
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
        h('p', { class: 't-label', text: '公开留言' }),
        h('div', { class: 'content-preview t-secondary', text: card.note || '未填写留言' }),
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
      drawer.setFooter([blacklistButton, h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })]);
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
      blacklistButton,
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

function openMorningMemberDrawer(member, { onDone } = {}) {
  const releaseButton = button({
    label: '解除拉黑',
    variant: 'secondary',
    iconName: 'refresh',
    disabled: !member.blacklistId,
    onClick: async () => {
      const confirmed = await confirmAction({
        title: '解除拉黑？',
        description: '解除后该成员可以重新报名；原名片不会自动恢复。',
        confirmLabel: '解除拉黑',
      });
      if (!confirmed) return;
      try {
        const payload = await runWithLoading(releaseButton, () => consoleApi.morning.releaseBlacklist(member.blacklistId));
        notify.success('已解除拉黑', payload.message);
        drawer.close();
        onDone?.();
      } catch (error) {
        reportError(error, '解除拉黑未完成');
      }
    },
  });
  const blacklistButton = button({
    label: '拉黑账号',
    variant: 'danger',
    iconName: 'shield',
    disabled: member.blacklisted,
    onClick: () => {
      drawer.close();
      openMorningBlacklistDrawer(member, { source: '成员预览', onDone });
    },
  });
  const drawer = openDrawer({
    placement: 'center',
    eyebrow: '早安晚安 · 成员预览',
    title: member.nickname || member.realName || member.accountId,
    description: member.cardId || member.accountId,
    width: 560,
    body: [
      h('div', { class: 'row-3 row-wrap' },
        statusFor(member.status),
        member.blacklisted ? badge('已拉黑', { tone: 'error', iconName: 'shield' }) : badge('正常', { tone: 'success' })
      ),
      definitionList([
        ['账号', member.accountId || '—'],
        ['真实姓名', member.realName || '—'],
        ['学号', member.studentId || '—'],
        ['性别', member.gender || '—'],
        ['校区', member.campus || '—'],
        ['学院', member.department || '未填写'],
        ['年级', member.grade || '未填写'],
        ['提交时间', member.submittedAt ? fmt.fullDateTime(member.submittedAt) : '—'],
        ['发布时间', member.publishedAt ? fmt.fullDateTime(member.publishedAt) : '—'],
        ['审核人', member.reviewedBy || '—'],
      ]),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '兴趣标签' }), tagBadges(member.interestTags)),
      member.blacklisted
        ? notice(`拉黑原因：${member.blacklistReason || '—'}`, { tone: 'warning', title: '黑名单记录' })
        : notice('成员当前未被拉黑。', { tone: 'neutral' }),
    ],
    footer: [
      member.blacklisted ? releaseButton : blacklistButton,
      h('span', { class: 'spacer' }),
      button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }),
    ],
  });
}

function openMorningRevisionDrawer(revisionId, { onDone } = {}) {
  const body = h('div', { class: 'stack-4' }, notice('正在读取资料更新…', { tone: 'neutral' }));
  let drawer;
  drawer = openDrawer({
    placement: 'center',
    width: 620,
    eyebrow: '早安晚安 · 资料更新审核',
    title: '名片资料更新',
    description: '审核通过后会更新广场名片；审核期间原名片继续展示。',
    body,
    footer: [button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
  });

  async function load() {
    try {
      const payload = await consoleApi.morning.revision(revisionId);
      render(payload.revision);
    } catch (error) {
      clear(body);
      body.append(notice(error.message || '资料更新无法加载。', { tone: 'error' }));
    }
  }

  function render(revision) {
    const pending = revision.status === REVISION_STATUS.PENDING;
    clear(body);
    body.append(
      h('div', { class: 'row-3 row-wrap' }, statusFor(revision.status), badge(revision.realName || revision.accountId, { tone: 'neutral' })),
      definitionList([
        ['名片编号', copyableCode(revision.cardId)],
        ['昵称', revision.nickname || '—'],
        ['校区', revision.campus || '—'],
        ['学院', revision.showDepartment ? revision.department || '—' : '不公开'],
        ['年级', revision.showGrade ? revision.grade || '—' : '不公开'],
        ['兴趣标签', revision.interestTags.join('、') || '—'],
        ['留言', revision.note || '—'],
        ['提交时间', revision.submittedAt ? fmt.fullDateTime(revision.submittedAt) : '—'],
      ]),
      notice('通过后会直接替换广场上的公开昵称、校区、兴趣标签、留言及学院/年级展示设置。', { tone: 'warning' }),
    );
    if (!pending) {
      body.append(definitionList([
        ['审核人', revision.reviewedBy || '—'],
        ['审核时间', revision.reviewedAt ? fmt.fullDateTime(revision.reviewedAt) : '—'],
        ['审核意见', revision.reviewNote || '—'],
      ]));
      return;
    }
    let decision = 'approve';
    const noteField = field({
      label: '审核意见',
      name: 'revisionReviewNote',
      multiline: true,
      rows: 3,
      maxlength: 300,
      placeholder: '退回或拒绝时必填。',
    });
    const appearance = {
      approve: { label: '通过并更新广场', variant: 'success' },
      return: { label: '退回修改', variant: 'secondary' },
      reject: { label: '拒绝更新', variant: 'danger' },
    };
    const syncDecision = () => {
      const current = appearance[decision] || appearance.approve;
      for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'success']) {
        submitButton.classList.toggle(`btn--${variant}`, variant === current.variant);
      }
      const label = submitButton.querySelector('span');
      if (label) label.textContent = current.label;
    };
    const decisionControl = segmented({
      items: [
        { value: 'approve', label: '通过并更新广场' },
        { value: 'return', label: '退回修改' },
        { value: 'reject', label: '拒绝更新' },
      ],
      value: decision,
      ariaLabel: '资料更新审核结果',
      role: 'radiogroup',
      onChange: value => {
        decision = value;
        decisionControl.setValue(value);
        syncDecision();
      },
    });
    const submitButton = button({
      label: '通过并更新广场',
      variant: 'success',
      iconName: 'check',
      onClick: () => submit(),
    });
    body.append(decisionControl, noteField);
    drawer.setFooter([
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ]);

    async function submit() {
      const note = noteField.control.value.trim();
      if (decision !== 'approve' && !note) {
        noteField.setError('退回或拒绝必须填写审核意见');
        shake(noteField);
        return;
      }
      try {
        const payload = await runWithLoading(submitButton, () => consoleApi.morning.reviewRevision(revision.id, {
          decision,
          note,
          expectedVersion: revision.version,
        }));
        notify.success('资料更新已处理', payload.message);
        drawer.close();
        onDone?.(payload);
      } catch (error) {
        if (error instanceof ApiError && error.status === 400) {
          noteField.setError(error.message);
          return;
        }
        if (error instanceof ApiError && error.status === 409) {
          notify.warning('资料状态已变化', error.message);
          return;
        }
        reportError(error, '资料更新审核未完成');
      }
    }
  }

  void load();
  return drawer;
}

export default async function morningAdminPage(context, shell) {
  const selectedReviewIds = new Set();
  let status = context.query.get('status') || CARD_STATUS.PENDING;
  if (!REVIEW_STATUS.has(status)) status = CARD_STATUS.PENDING;
  let memberView = 'members';
  let blacklistStatus = BLACKLIST_STATUS.ACTIVE;
  const requestedView = context.query.get('view');
  let view = ['review', 'invitations', 'members'].includes(requestedView) ? requestedView : 'review';

  const bodySlot = h('div', { class: 'stack-6' });

  const viewControl = segmented({
    items: [
      { value: 'review', label: '名片审核' },
      { value: 'invitations', label: '好友邀约' },
      { value: 'members', label: '成员管理' },
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
    load: () => {
      const revisionStatus = status === CARD_STATUS.PUBLISHED
        ? REVISION_STATUS.APPROVED
        : [CARD_STATUS.PENDING, CARD_STATUS.RETURNED, CARD_STATUS.REJECTED].includes(status) ? status : '';
      const revisions = revisionStatus
        ? consoleApi.morning.revisions({ status: revisionStatus })
        : Promise.resolve({ revisions: [], stats: {} });
      return Promise.all([consoleApi.morning.cards({ status }), revisions]).then(([cardPayload, revisionPayload]) => {
        const cardStats = cardPayload.stats || {};
        const revisionStats = revisionPayload.stats || {};
        return {
          stats: {
            pending: (cardStats.pending || 0) + (revisionStats.pending || 0),
            published: (cardStats.published || 0) + (revisionStats.approved || 0),
            returned: (cardStats.returned || 0) + (revisionStats.returned || 0),
            rejected: (cardStats.rejected || 0) + (revisionStats.rejected || 0),
            exited: cardStats.exited || 0,
          },
          cards: [
            ...(cardPayload.cards || []).map(row => ({ ...row, reviewType: 'card' })),
            ...(revisionPayload.revisions || []).map(row => ({ ...row, reviewType: 'revision' })),
          ],
        };
      });
    },
    render: (payload, { reload }) => {
      const stats = payload.stats || {};
      const rows = payload.cards || [];
      const selectStatus = (next) => {
        status = next;
        tabControl.setValue(next);
        reload();
      };
      const batch = status === CARD_STATUS.PENDING
        ? batchApprovalControls({
            rows,
            selectedIds: selectedReviewIds,
            label: '审核记录',
            unit: '条',
            onApprove: row => row.reviewType === 'revision'
              ? consoleApi.morning.reviewRevision(row.id, { decision: 'approve', note: '', expectedVersion: row.version })
              : consoleApi.morning.review(row.id, { decision: 'approve', note: '' }),
            onDone: async () => { await reload(); shell.refreshTodos(); },
          })
        : null;
      const openReviewRow = row => row.reviewType === 'revision'
        ? openMorningRevisionDrawer(row.id, { onDone: async () => { await reload(); shell.refreshTodos(); } })
        : openMorningReviewDrawer(row.id, { onDone: async () => { await reload(); shell.refreshTodos(); } });
      const approveRow = async (row, control) => {
        try {
          const result = await runWithLoading(control, () => row.reviewType === 'revision'
            ? consoleApi.morning.reviewRevision(row.id, { decision: 'approve', note: '', expectedVersion: row.version })
            : consoleApi.morning.review(row.id, { decision: 'approve', note: '' }));
          notify.success(row.reviewType === 'revision' ? '资料更新已通过' : '名片已通过并发布', result.message);
          await reload();
          shell.refreshTodos();
        } catch (error) {
          reportError(error, '审核未完成');
        }
      };
      return [
        metricRow(
          [
            metric({ label: '待审核', value: stats.pending || 0, unit: '条', tone: stats.pending ? 'warn' : '', onClick: () => selectStatus(CARD_STATUS.PENDING) }),
            metric({ label: '已发布', value: stats.published || 0, unit: '张', onClick: () => selectStatus(CARD_STATUS.PUBLISHED) }),
            metric({ label: '需修改', value: stats.returned || 0, unit: '条', tone: stats.returned ? 'warn' : '', onClick: () => selectStatus(CARD_STATUS.RETURNED) }),
            metric({ label: '已拒绝', value: stats.rejected || 0, unit: '条', onClick: () => selectStatus(CARD_STATUS.REJECTED) }),
            metric({ label: '已退出', value: stats.exited || 0, unit: '张', onClick: () => selectStatus(CARD_STATUS.WITHDRAWN) }),
          ],
          { columns: 5 },
        ),
        batch?.toolbar,
        dataTable({
          columns: [
            ...(batch ? [{ key: 'selected', label: '选择', className: 'community-review-selection', sortable: false, render: row => batch.selectionCell(row) }] : []),
            { key: 'id', label: '记录编号', mono: true, render: row => h('code', { class: 't-data', text: row.id }) },
            { key: 'reviewType', label: '申请类型', render: row => badge(row.reviewType === 'revision' ? '资料更新' : '首次报名', { tone: row.reviewType === 'revision' ? 'accent' : 'neutral' }) },
            { key: 'nickname', label: '昵称', strong: true, render: row => h('span', { text: row.nickname || row.realName || row.id }) },
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
          searchPlaceholder: '搜索成员、记录编号、校区或兴趣标签',
          searchKeys: ['id', 'cardId', 'nickname', 'realName', 'campus', 'interestTags', 'reviewType'],
          countLabel: count => `${count} 条${status}审核记录`,
          empty: emptyState({
            iconName: status === CARD_STATUS.PENDING ? 'inbox' : 'handshake',
            title: status === CARD_STATUS.PENDING ? '没有待审核的报名名片' : `没有${status}名片`,
            description: status === CARD_STATUS.PENDING
              ? '成员报名和已发布名片的资料更新都会进入这里；通过后才会公开展示。'
              : '可以切换上方状态查看其他审核记录。',
          }),
          onRowClick: openReviewRow,
          buildRowAction: row => {
            let action;
            action = button({
              label: row.status === CARD_STATUS.PENDING ? '通过' : '查看',
              variant: row.status === CARD_STATUS.PENDING ? 'primary' : 'secondary',
              size: 'sm',
              iconName: row.status === CARD_STATUS.PENDING ? 'check' : 'search',
              ariaLabel: `${row.status === CARD_STATUS.PENDING ? '通过' : '查看'}审核记录 ${row.nickname || row.realName || row.id}`,
              onClick: () => row.status === CARD_STATUS.PENDING ? approveRow(row, action) : openReviewRow(row),
            });
            return action;
          },
        }),
        notice('实名信息只用于管理员核验，不会进入公开广场。只有审核通过的公开昵称、校区、兴趣标签和留言会对外展示。', {
          tone: 'info',
          iconName: 'shield',
        }),
      ];
    },
  });

  const invitationsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '好友邀约数据无法加载',
    load: () => consoleApi.morning.invitations(),
    render: (payload) => {
      const stats = payload.stats || {};
      const rows = payload.invitations || [];
      return [
        metricRow([
          metric({ label: '邀约总数', value: stats.total || 0, unit: '条', animate: false }),
          metric({ label: '等待反馈', value: stats.sent || 0, unit: '条', tone: stats.sent ? 'warn' : '', animate: false }),
          metric({ label: '成功结识', value: stats.success || 0, unit: '条', animate: false }),
          metric({ label: '成功率', value: stats.successRate || 0, unit: '%', animate: false }),
        ], { columns: 4 }),
        dataTable({
          columns: [
            { key: 'id', label: '邀约编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'inviterNickname', label: '发起人', strong: true },
            { key: 'recipientNickname', label: '收件人', strong: true },
            { key: 'inviterCampus', label: '校区', render: (row) => badge(row.inviterCampus || '—', { tone: 'accent' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'message', label: '邀约附言', render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.message || '未填写' }) },
            { key: 'createdAt', label: '发出时间', render: (row) => h('span', { class: 't-caption', text: row.createdAt ? fmt.relative(row.createdAt) : '—' }) },
            { key: 'feedbackAt', label: '反馈时间', render: (row) => h('span', { class: 't-caption', text: row.feedbackAt ? fmt.relative(row.feedbackAt) : '—' }) },
            { key: 'coordinatorNotifyStatus', label: '指导组通知', render: (row) => h('span', { class: 't-caption', text: row.coordinatorNotifyStatus || '—' }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索邀约编号、昵称、校区或状态',
          searchKeys: ['id', 'inviterNickname', 'recipientNickname', 'inviterCampus', 'status', 'message'],
          countLabel: (count) => `${count} 条邀约记录`,
          empty: emptyState({
            iconName: 'send',
            title: '还没有好友邀约',
            description: '成员在同行广场发起邀约后，记录会显示在这里。',
          }),
        }),
        notice('成功结识数来自收件人通过三天反馈链接完成的报备；邮箱地址不会在管理列表中完整公开。', {
          tone: 'info',
          iconName: 'shield',
        }),
      ];
    },
  });

  const memberViewControl = segmented({
    items: [
      { value: 'members', label: '成员预览' },
      { value: 'blacklist', label: '黑名单' },
    ],
    value: memberView,
    ariaLabel: '成员管理视图',
    role: 'radiogroup',
    onChange: (value) => {
      memberView = value;
      memberViewControl.setValue(value);
      membersRegion.reload();
    },
  });

  const membersRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '成员管理数据无法加载',
    load: () => Promise.all([
      consoleApi.morning.members(),
      consoleApi.morning.blacklist({ status: blacklistStatus }),
    ]).then(([members, blacklist]) => ({ members, blacklist })),
    render: ({ members: memberPayload, blacklist: blacklistPayload }, { reload }) => {
      const memberStats = memberPayload.stats || {};
      const blacklistStats = blacklistPayload.stats || {};
      const members = memberPayload.members || [];
      const blacklistEntries = blacklistPayload.entries || [];
      const reloadAll = async () => {
        await reload();
        shell.refreshTodos();
      };
      const metrics = memberView === 'blacklist'
        ? metricRow([
            metric({ label: '黑名单总数', value: blacklistStats.total || 0, unit: '人', animate: false }),
            metric({ label: '生效中', value: blacklistStats.active || 0, unit: '人', tone: blacklistStats.active ? 'warn' : '', animate: false }),
            metric({ label: '已解除', value: blacklistStats.released || 0, unit: '人', animate: false }),
          ], { columns: 3 })
        : metricRow([
            metric({ label: '成员总数', value: memberStats.total || 0, unit: '人', animate: false }),
            metric({ label: '已发布', value: memberStats.published || 0, unit: '人', animate: false }),
            metric({ label: '待审核', value: memberStats.pending || 0, unit: '人', tone: memberStats.pending ? 'warn' : '', animate: false }),
            metric({ label: '黑名单', value: memberStats.blacklisted || 0, unit: '人', tone: memberStats.blacklisted ? 'warn' : '', animate: false }),
          ], { columns: 4 });
      const table = memberView === 'blacklist'
        ? dataTable({
            columns: [
              { key: 'realName', label: '姓名', strong: true, render: (row) => h('span', { text: row.realName || row.nickname || '—' }) },
              { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
              { key: 'accountId', label: '账号', mono: true },
              { key: 'reason', label: '拉黑原因', render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.reason }) },
              { key: 'source', label: '来源', render: (row) => badge(row.source || '控制台', { tone: 'neutral' }) },
              { key: 'operator', label: '操作人' },
              { key: 'createdAt', label: '拉黑时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.createdAt) }) },
              { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            ],
            rows: blacklistEntries,
            getKey: (row) => row.id,
            searchPlaceholder: '搜索姓名、学号、账号或原因',
            searchKeys: ['realName', 'nickname', 'studentId', 'accountId', 'reason'],
            actions: [memberViewControl],
            countLabel: (count) => `${count} 条黑名单记录`,
            empty: emptyState({ iconName: 'shield', title: '没有黑名单记录', description: '在名片审核或成员预览中拉黑账号后，记录会显示在这里。' }),
            buildRowAction: (row) => {
              let action;
              action = button({
                label: '解除拉黑',
                variant: 'secondary',
                size: 'sm',
                iconName: 'refresh',
                disabled: row.status !== BLACKLIST_STATUS.ACTIVE,
                ariaLabel: `解除拉黑 ${row.realName || row.nickname || row.accountId}`,
                onClick: async () => {
                  const confirmed = await confirmAction({
                    title: '解除拉黑？',
                    description: '解除后该成员可以重新报名；原名片不会自动恢复。',
                    confirmLabel: '解除拉黑',
                  });
                  if (!confirmed) return;
                  try {
                    const payload = await runWithLoading(action, () => consoleApi.morning.releaseBlacklist(row.id));
                    notify.success('已解除拉黑', payload.message);
                    await reloadAll();
                  } catch (error) {
                    reportError(error, '解除拉黑未完成');
                  }
                },
              });
              return action;
            },
          })
        : dataTable({
            columns: [
              { key: 'nickname', label: '昵称', strong: true },
              { key: 'realName', label: '真实姓名', render: (row) => h('span', { text: row.realName || '—' }) },
              { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
              { key: 'campus', label: '校区', render: (row) => badge(row.campus || '—', { tone: 'accent' }) },
              { key: 'interestTags', label: '兴趣标签', value: (row) => (row.interestTags || []).join('、'), render: (row) => tagBadges(row.interestTags) },
              { key: 'status', label: '名片状态', sortable: false, render: (row) => statusFor(row.status) },
              { key: 'blacklisted', label: '黑名单', sortable: false, render: (row) => row.blacklisted ? badge('已拉黑', { tone: 'error', iconName: 'shield' }) : badge('正常', { tone: 'success' }) },
              { key: 'publishedAt', label: '发布时间', render: (row) => h('span', { class: 't-caption', text: row.publishedAt ? fmt.relative(row.publishedAt) : '—' }) },
            ],
            rows: members,
            getKey: (row) => row.cardId || row.accountId,
            searchPlaceholder: '搜索昵称、姓名、学号或标签',
            searchKeys: ['nickname', 'realName', 'studentId', 'campus', 'interestTags'],
            actions: [memberViewControl],
            countLabel: (count) => `${count} 位成员`,
            empty: emptyState({ iconName: 'users', title: '还没有成员名片', description: '成员提交报名名片后会显示在这里。' }),
            onRowClick: (row) => openMorningMemberDrawer(row, { onDone: reloadAll }),
            buildRowAction: (row) => button({
              label: row.blacklisted ? '查看' : '成员预览',
              variant: 'secondary',
              size: 'sm',
              iconName: 'eye',
              ariaLabel: `${row.blacklisted ? '查看' : '预览'}成员 ${row.nickname || row.realName || row.accountId}`,
              onClick: () => openMorningMemberDrawer(row, { onDone: reloadAll }),
            }),
          });
      return [
        metrics,
        table,
        notice('成员预览包含审核所需的实名信息；黑名单会立即撤下现有名片，并阻止重新报名和发起邀约。', { tone: 'info', iconName: 'shield' }),
      ];
    },
  });

  function renderPage() {
    clear(bodySlot);
    const current = view === 'invitations' ? invitationsRegion : view === 'members' ? membersRegion : region;
    const statusControl = view === 'members' ? memberViewControl : view === 'review' ? tabControl : null;
    current.ensureLoaded();
    bodySlot.append(
      h('div', { class: 'row-3 row-wrap' }, viewControl, h('span', { class: 'spacer' }), reloadAction(current, '刷新')),
      statusControl ? h('div', { class: 'row-3 row-wrap' }, statusControl) : null,
      current,
    );
    requestAnimationFrame(() => {
      viewControl.reposition?.();
      statusControl?.reposition?.();
    });
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide operations-module operations-community' },
    pageHead({
      label: '温暖连接 · 早安晚安',
      title: '早安晚安管理',
      description: '统一审核成员报名与名片资料更新，并管理好友邀约和成员状态。',
      meta: [badge('人工审核闸门', { tone: 'warning', iconName: 'shield' })],
      actions: [button({ label: '查看公众广场', variant: 'secondary', iconAfter: 'external', href: '/morning/plaza', data: { native: 'true' } })],
    }),
    communityModuleNav('morning'),
    bodySlot,
  );

  renderPage();
  return { title: '早安晚安管理', crumb: '早安晚安管理', node };
}
