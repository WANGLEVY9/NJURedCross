/* ==========================================================================
   portal/warmth-panels.js
   「我写的生日祝福」/「我收到的生日祝福」两个**可折叠**面板。
   会员中心与内建中心共用同一套渲染，避免两处 UI 漂移。
   ========================================================================== */

import { h } from '../core/dom.js';
import { button, badge, emptyState, queueRow, statusIndicator, definitionList } from '../ui/primitives.js';
import { openModal } from '../ui/overlay.js';
import { navigate, getCurrent } from '../core/router.js';
import { deleteWrittenBlessing } from './blessing-actions.js';
import * as fmt from '../core/format.js';
import { openBlessingDrawer } from './blessing-drawer.js';
import { renderBlessingLetter, openBlessingLetterModal, openBlessingReportDialog } from './blessing-letter.js';

const DELIVERED_SOURCE_LABELS = { 指定: '有同学指定送给你', 一对一匹配: '随机匹配送给你', 仓库抽取: '来自祝福仓库' };

function toneFor(status) {
  const value = String(status || '');
  if (value.includes('已举报')) {
    if (value.includes('已处理') || value.includes('已受理')) return 'success';
    if (value.includes('已驳回')) return 'neutral';
    return 'warning';
  }
  if (['已确认', '已通过', '已签到', '已送达'].includes(value)) return 'success';
  if (['已取消', '需修改', '已退出', '已拒绝'].includes(value)) return 'error';
  return 'warning';
}
function priorityFor(status) {
  const tone = toneFor(status);
  return tone === 'success' ? 'low' : tone === 'error' ? 'high' : 'medium';
}
function blessingRow({ type, title, status, detail, onClick = null, action = null, data = null, ariaLabel = null }) {
  return queueRow({
    type,
    title,
    detail: detail || '',
    priority: priorityFor(status),
    meta: [statusIndicator(status || '未知', { tone: toneFor(status) })],
    onClick,
    action,
    data: data || {},
    ariaLabel,
  });
}
/** 收到的祝福：把举报状态放在状态位上，举报人一眼看到进展。 */
function deliveredStatus(item) {
  if (!item.reported) return '已送达';
  if (item.reportStatus === '已处理') return '已举报 · 已受理';
  if (item.reportStatus === '已驳回') return '已举报 · 已驳回';
  return '已举报 · 处理中';
}

/** 折叠面板：标题栏右侧「展开/收起」，带 aria-expanded / aria-controls。 */
function collapsiblePanel({ id, title, description, count, rows, emptyTitle, emptyDescription, emptyAction = null, defaultOpen = false }) {
  const bodyId = `${id}-body`;
  const body = h(
    'div',
    { class: 'panel__body', id: bodyId, hidden: !defaultOpen },
    rows.length
      ? h('div', { class: 'queue' }, ...rows)
      : emptyState({ iconName: 'inbox', title: emptyTitle, description: emptyDescription, actions: emptyAction ? [emptyAction] : [] }),
  );
  const toggle = button({ label: defaultOpen ? '收起' : '展开', variant: 'ghost', size: 'sm', iconName: 'chevronDown', onClick: () => setOpen(body.hidden) });
  toggle.setAttribute('aria-expanded', String(defaultOpen));
  toggle.setAttribute('aria-controls', bodyId);
  function setOpen(open) {
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    const label = toggle.querySelector('span');
    if (label) label.textContent = open ? '收起' : '展开';
  }
  const panel = h(
    'section',
    { class: 'panel member-anchor', id },
    h(
      'header',
      { class: 'panel__head' },
      h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: title }), h('p', { class: 't-caption', text: description })),
      h('span', { class: 'spacer' }),
      badge(`${count} 条`, { tone: count ? 'accent' : 'neutral' }),
      toggle,
    ),
    body,
  );
  // 供外部（例如内建中心顶部的举报横幅）展开并滚动定位
  panel.setOpen = setOpen;
  return panel;
}

/** 未审核与「需修改」可编辑；已通过只可删除；已拒绝只可重写。 */
const EDITABLE_BLESSING_STATUSES = ['待审核', '需修改'];

/** 「查看」为纯预览：不提供编辑 / 删除，操作统一放在行内按钮与编辑抽屉里。 */
function openWrittenBlessingPreview(item) {
  let modal;
  modal = openModal({
    title: '生日祝福预览',
    width: 680,
    body: [
      renderBlessingLetter({ content: item.content || item.excerpt || '', nickname: item.nickname, submittedAt: item.submittedAt, seal: item.status }),
      definitionList([
        ['状态', item.status],
        ['投递方式', item.delivery || '—'],
        ['提交时间', fmt.fullDateTime(item.submittedAt)],
        item.reviewNote ? ['审核意见', item.reviewNote] : item.previousReviewNote ? ['上一次审核意见', item.previousReviewNote] : null,
      ].filter(Boolean)),
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => modal.close() })],
  });
}

/** 未加入计划时：跳到内建广场的加入入口；已在广场则滚动到该入口。 */
function goToJoinEntry() {
  const path = getCurrent()?.path || location.pathname;
  if (path === '/warmth' || path === '/community') {
    document.getElementById('warmth-write-entry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  navigate('/warmth');
}

export function buildWrittenBlessingsPanel(blessings = [], { id = 'member-warmth-blessings', defaultOpen = false, onChanged = null, joined = true } = {}) {
  return collapsiblePanel({
    id,
    title: '我写的生日祝福',
    description: '每条都可就地操作：查看详情、编辑（含删除）或重写。',
    count: blessings.length,
    defaultOpen,
    rows: blessings.map((item) => {
      const editable = EDITABLE_BLESSING_STATUSES.includes(item.status);
      const rejected = item.status === '已拒绝';
      return blessingRow({
        type: '生日祝福',
        title: item.excerpt || item.content?.slice(0, 60) || '生日祝福投稿',
        status: item.status,
        detail: [
          `内容：${item.content || item.excerpt || ''}`,
          item.id,
          fmt.fullDateTime(item.submittedAt),
          item.delivery,
          item.reviewNote ? `审核意见：${item.reviewNote}` : item.previousReviewNote ? `上一次审核意见：${item.previousReviewNote}` : '',
          editable ? '可直接「编辑」，或「查看」详情' : rejected ? '审核不通过，可点「重写」再写一条' : '点「查看」详情',
        ].filter(Boolean).join(' · '),
        onClick: null,
        action: h('div', { class: 'row-2 row-wrap' },
          button({ label: '查看', variant: 'ghost', size: 'sm', onClick: () => openWrittenBlessingPreview(item) }),
          editable ? button({ label: '编辑', variant: 'primary', size: 'sm', onClick: () => openBlessingDrawer({ blessing: item, onDone: onChanged }) }) : null,
          !editable && !rejected ? button({ label: '删除', variant: 'danger', size: 'sm', onClick: () => deleteWrittenBlessing(item, { onChanged }) }) : null,
          rejected ? button({ label: '重写', variant: 'primary', size: 'sm', iconName: 'sparkle', onClick: () => openBlessingDrawer({ onDone: onChanged }) }) : null,
        ),
        data: { actions: 'true' },
      });
    }),
    emptyTitle: '还没有生日祝福投稿',
    emptyDescription: '加入生日祝福计划后就可以给同学写祝福，审核通过后也会收到一对一的祝福。',
    emptyAction: joined
      ? button({ label: '去写祝福', variant: 'primary', size: 'sm', iconName: 'sparkle', onClick: () => openBlessingDrawer({ onDone: onChanged }) })
      : button({ label: '加入生日祝福', variant: 'primary', size: 'sm', iconName: 'heart', onClick: goToJoinEntry }),
  });
}

/** 打开某条已送达祝福的详情弹窗（举报入口与处理进展都在里面）。内建中心顶部横幅也用它。 */
export function openReceivedBlessingDetail(item, { onChanged = null } = {}) {
  return openBlessingLetterModal({
    title: '收到的生日祝福',
    content: item.content,
    nickname: item.nickname,
    campus: item.senderCampus,
    origin: item.writtenLabel,
    seal: '已送达',
    rows: [
      ['来源', DELIVERED_SOURCE_LABELS[item.source] || '—'],
      ['送达时间', fmt.fullDateTime(item.deliveredAt)],
    ],
    reportable: true,
    reported: item.reported,
    reportStatus: item.reportStatus,
    reportResolution: item.reportResolution,
    onReport: () => openBlessingReportDialog({ submissionId: item.submissionId, onDone: onChanged }),
  });
}

export function buildReceivedBlessingsPanel(delivered = [], { id = 'member-warmth-delivered', defaultOpen = false, onChanged = null } = {}) {
  // 管理员受理举报并撤下的祝福，从收件列表消失（举报进展在顶部横幅里保留）
  const visible = delivered.filter((item) => !item.withdrawn);
  return collapsiblePanel({
    id,
    title: '我收到的生日祝福',
    description: '生日当天由平台送达；举报后这里会显示处理进展。',
    count: visible.length,
    defaultOpen,
    rows: visible.map((item) => blessingRow({
      type: '收到的祝福',
      title: item.content,
      status: deliveredStatus(item),
      detail: [
        item.nickname ? `来自：${item.nickname}` : '',
        item.senderCampus ? `写信人校区：${item.senderCampus}` : '',
        DELIVERED_SOURCE_LABELS[item.source] || '',
        item.deliveredAt ? fmt.fullDateTime(item.deliveredAt) : '',
        item.reported ? '查看举报进展' : '点击查看详情',
      ].filter(Boolean).join(' · '),
      onClick: () => openReceivedBlessingDetail(item, { onChanged }),
      ariaLabel: `查看来自 ${item.nickname || '一位同学'} 的生日祝福`,
    })),
    emptyTitle: '还没有收到生日祝福',
    emptyDescription: '生日当天，写给你的祝福会送达到这里，可以随时点开慢慢读。',
  });
}
