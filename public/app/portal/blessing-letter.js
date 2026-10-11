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

/** 把时间格式化为「xxxx年xx月xx日 早上/下午/晚上」（Asia/Shanghai）。 */
function letterOriginTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const hour = Number(get('hour')) % 24;
  const period = hour >= 5 && hour < 12 ? '早上' : hour >= 12 && hour < 18 ? '下午' : '晚上';
  return `${get('year')}年${get('month')}月${get('day')}日 ${period}`;
}

export function renderBlessingLetter({ content = '', nickname = '', campus = '', origin = '', submittedAt = null, seal = '' } = {}) {
  return h(
    'div',
    { class: 'warmth-letter' },
    seal ? h('span', { class: 'warmth-letter__seal', text: seal }) : null,
    h('p', { class: 'blessing-preview__content', text: content }),
    h(
      'p',
      { class: 'warmth-letter__signature' },
      h('span', { class: 'warmth-letter__signature-name', text: `来自：${nickname || '匿名'}` }),
      h('span', { text: `TA的校区：${campus ? `${campus}校区` : '—'}` }),
      h('span', { text: `这份心意来自 ${origin || letterOriginTime(submittedAt)}` }),
    ),
  );
}

const REPORT_TONE = { 待处理: 'warning', 已处理: 'success', 已驳回: 'neutral' };

/** 举报状态在详情弹窗顶部醒目展示，处理结论一并给出。 */
function reportNotice(reported, reportStatus, reportResolution) {
  if (!reported && !reportStatus) return null;
  if (reportStatus === '已处理') return notice(`举报已受理：${reportResolution || '管理员已核实并处理你的举报。'}`, { tone: 'success', title: '举报状态' });
  if (reportStatus === '已驳回') return notice(`举报未予受理：${reportResolution || '管理员核实后未予受理。'}`, { tone: 'neutral', title: '举报状态' });
  return notice('举报已提交，管理员正在处理，处理结果会在这里显示。', { tone: 'warning', title: '举报状态' });
}

export function openBlessingLetterModal({ title = '生日祝福', content, nickname, campus = '', origin = '', submittedAt, seal = '', rows = [], reportable = false, reported = false, reportStatus = '', reportResolution = '', onReport = null } = {}) {
  let modal;
  const reportAction = reported
    ? badge('已举报', { tone: 'neutral', iconName: 'shield' })
    : (reportable && onReport ? button({ label: '举报', variant: 'ghost', size: 'sm', iconName: 'alert', onClick: () => { modal.close(); onReport(); } }) : null);
  modal = openModal({
    title,
    width: 680,
    body: [
      reportNotice(reported, reportStatus, reportResolution),
      renderBlessingLetter({ content, nickname, campus, origin, submittedAt, seal }),
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
