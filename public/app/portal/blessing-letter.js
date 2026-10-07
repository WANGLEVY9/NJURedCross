/* ==========================================================================
   portal/blessing-letter.js
   共享「祝福信件」渲染与详情弹窗：
     · 会员中心「我写的生日祝福」预览 /「我收到的生日祝福」详情
     · 生日当天打开的祝福弹窗
   ========================================================================== */

import { h } from '../core/dom.js';
import { openModal } from '../ui/overlay.js';
import { button, definitionList, field, notice, runWithLoading, badge } from '../ui/primitives.js';
import * as fmt from '../core/format.js';
import { publicApi, ApiError } from '../core/api.js';
import { notify, reportError } from '../core/toast.js';
import { shake } from '../core/motion.js';

export function renderBlessingLetter({ content = '', nickname = '', submittedAt = null, seal = '' } = {}) {
  return h(
    'div',
    { class: 'warmth-letter' },
    seal ? h('span', { class: 'warmth-letter__seal', text: seal }) : null,
    h('p', { class: 'blessing-preview__content', text: content }),
    h(
      'p',
      { class: 'warmth-letter__signature' },
      h('b', { text: nickname || '匿名' }),
      h('span', { text: submittedAt ? fmt.fullDateTime(submittedAt) : '' }),
    ),
  );
}

export function openBlessingLetterModal({ title = '生日祝福', content, nickname, submittedAt, seal = '', rows = [], reportable = false, reported = false, onReport = null } = {}) {
  let modal;
  const reportAction = reported
    ? badge('已举报', { tone: 'neutral', iconName: 'shield' })
    : (reportable && onReport ? button({ label: '举报', variant: 'ghost', size: 'sm', iconName: 'alert', onClick: () => { modal.close(); onReport(); } }) : null);
  modal = openModal({
    title,
    width: 680,
    body: [
      renderBlessingLetter({ content, nickname, submittedAt, seal }),
      rows.length ? definitionList(rows) : null,
    ].filter(Boolean),
    footer: [reportAction, h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => modal.close() })].filter(Boolean),
  });
  return modal;
}

/** 举报某条已送达的祝福：填写理由后推送给管理端。 */
export function openBlessingReportDialog({ submissionId, onDone } = {}) {
  const reasonField = field({ label: '举报理由', name: 'reportReason', multiline: true, rows: 4, maxlength: 500, required: true, placeholder: '请说明这条祝福的问题，例如包含联系方式、语气不当或涉及隐私。' });
  const submitButton = button({ label: '提交举报', variant: 'danger', iconName: 'alert', onClick: () => submit() });
  let modal;
  modal = openModal({
    title: '举报这条祝福',
    width: 480,
    body: [notice('举报会推送给管理端核实处理；请如实填写理由。', { tone: 'warning' }), reasonField],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => modal.close() }), submitButton],
  });
  async function submit() {
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason) { reasonField.setError('请填写举报理由'); shake(reasonField); reasonField.control.focus(); return; }
    try {
      await runWithLoading(submitButton, () => publicApi.reportWarmthBlessing(submissionId, { reason }));
      notify.success('举报已提交', '管理员会核实并处理。');
      modal.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.isConflict)) { reasonField.setError(error.message); shake(reasonField); return; }
      reportError(error, '举报失败');
    }
  }
}
