/* ==========================================================================
   portal/blessing-drawer.js
   Shared create/edit drawer for birthday blessings. Used by /warmth and /me.
   ========================================================================== */

import { h } from '../core/dom.js';
import { publicApi, ApiError } from '../core/api.js';
import { shake } from '../core/motion.js';
import { openDrawer } from '../ui/overlay.js';
import { button, field, checkbox, notice, receipt, segmented, runWithLoading } from '../ui/primitives.js';
import { notify, reportError } from '../core/toast.js';
import { redirectIfAuthError } from './auth-gate.js';

const DELIVERY_HINTS = {
  specific: '只送给这个学号对应的同学；对方还没加入计划时会先等待，等他加入后进入审核队列。指定给某人的祝福不换取一对一祝福。',
  random: '系统会随机匹配一位已加入计划的同学作为收件人，对方看不到你的联系方式。随机匹配与祝福仓库的投稿，都会为你换取等量的一对一祝福。',
  repository: '审核通过后，它会住进红会祝福库，一次次被送到不同的同学手中，也会为你换回等量的一对一祝福。谢谢你留下这份温柔。',
};
const DELIVERY_KEY_BY_LABEL = { 指定学号: 'specific', 随机匹配: 'random', 祝福仓库: 'repository' };
const REPOSITORY_USED_HINT = '你已写过一条祝福仓库（每人限一条）；如需调整，请在会员中心「我写的生日祝福」里修改。';

export function openBlessingDrawer({ blessing = null, onDone } = {}) {
  const editing = Boolean(blessing?.id);
  let delivery = blessing?.deliveryKey || DELIVERY_KEY_BY_LABEL[blessing?.delivery] || 'random';
  let repositoryUsed = false;
  const hintId = `blessing-delivery-hint-${Math.random().toString(36).slice(2, 7)}`;

  const nicknameField = field({ label: '你的昵称', name: 'blessingNickname', required: true, maxlength: 40, value: blessing?.nickname || '', placeholder: '其他参与者会看到这个称呼', hint: '这个昵称会展示给收到祝福的同学。' });
  const contentField = field({ label: '祝福内容', name: 'content', multiline: true, rows: 5, maxlength: 1000, required: true, value: blessing?.content || '', placeholder: '写下你想送给同学的生日祝福。提交后会先进入人工审核。' });
  const targetField = field({ label: '对方学号', name: 'targetStudentId', value: blessing?.targetStudentId || '', placeholder: '例如 20220001', hint: '只能指定已经注册平台账号的同学；对方还没加入计划时会先等待。' });
  const deliveryHint = h('p', { class: 't-caption t-secondary blessing-delivery-hint', id: hintId, text: DELIVERY_HINTS[delivery] });
  const deliveryControl = segmented({
    items: [
      { value: 'specific', label: '指定学号' },
      { value: 'random', label: '随机匹配' },
      { value: 'repository', label: '祝福仓库' },
    ],
    value: delivery,
    ariaLabel: '投递方式',
    describedBy: hintId,
    onChange: (value) => {
      delivery = value;
      deliveryControl.setValue(value);
      deliveryHint.textContent = value === 'repository' && repositoryUsed ? REPOSITORY_USED_HINT : DELIVERY_HINTS[value];
      targetField.hidden = value !== 'specific';
    },
  });
  targetField.hidden = delivery !== 'specific';
  // 祝福仓库每人限一条：提前取一次自己的投稿用于前端提示（服务端仍会兜底拦截）
  if (!editing) {
    void publicApi.myWarmthBlessings()
      .then((payload) => {
        repositoryUsed = (payload.blessings || []).some((item) => item.deliveryKey === 'repository' && item.status !== '已拒绝');
        if (repositoryUsed && delivery === 'repository') deliveryHint.textContent = REPOSITORY_USED_HINT;
      })
      .catch(() => { /* 读取失败时交给服务端拦截 */ });
  }

  const consent = checkbox({
    name: 'blessingConsent',
    label: '我确认这段祝福由我本人撰写',
    description: '内容会先经过人工审核，通过后才会转达或被祝福仓库调用。',
  });
  const consentErrorId = `blessing-consent-error-${Math.random().toString(36).slice(2, 7)}`;
  const consentError = h('p', { class: 'field__error', id: consentErrorId, attrs: { role: 'alert' }, hidden: true });
  // Keep the consent error programmatically tied to the checkbox so screen
  // readers announce the reason when it appears (WCAG 3.3.1 / 1.3.1).
  consent.control.setAttribute('aria-describedby', consentErrorId);
  const submitButton = button({ label: editing ? '保存修改' : '提交祝福', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '生日祝福',
    title: editing ? '修改生日祝福' : '给同学写一句祝福',
    description: editing ? '未审核的修改不改变审核顺序；被退回的会重新进入审核序列' : '可以写多次 · 人工审核',
    width: 520,
    body: [
      nicknameField,
      contentField,
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '这份祝福送给谁' }), deliveryControl),
      deliveryHint,
      notice('收件规则：「随机匹配」和「祝福仓库」的投稿，都会为你换取等量的一对一祝福。祝福仓库每个账号只能投稿一条。', { tone: 'info' }),
      targetField,
      consent,
      consentError,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    nicknameField.setError(null);
    contentField.setError(null);
    targetField.setError(null);
    consentError.hidden = true;
    consent.control.removeAttribute('aria-invalid');
    if (!nicknameField.control.value.trim()) { nicknameField.setError('请填写昵称'); shake(nicknameField); nicknameField.control.focus(); return; }
    if (!contentField.control.value.trim()) { contentField.setError('请写下祝福内容'); shake(contentField); contentField.control.focus(); return; }
    if (delivery === 'specific' && !/^\d{6,20}$/.test(targetField.control.value.trim())) { targetField.setError('请输入有效的学号'); shake(targetField); targetField.control.focus(); return; }
    if (!editing && delivery === 'repository' && repositoryUsed) {
      deliveryHint.textContent = REPOSITORY_USED_HINT;
      notify.warning('祝福仓库每人限一条', '你已写过一条祝福仓库；可在会员中心修改它，或改为随机匹配 / 指定学号。');
      shake(deliveryControl);
      return;
    }
    if (!consent.control.checked) {
      consentError.textContent = '请确认这段祝福由你本人撰写。';
      consentError.hidden = false;
      consent.control.setAttribute('aria-invalid', 'true');
      consent.control.focus();
      shake(consent);
      return;
    }
    const body = {
      nickname: nicknameField.control.value.trim(),
      content: contentField.control.value.trim(),
      delivery,
      targetStudentId: delivery === 'specific' ? targetField.control.value.trim() : '',
      consent: true,
    };
    try {
      const payload = await runWithLoading(submitButton, () => editing ? publicApi.resubmitWarmthBlessing(blessing.id, body) : publicApi.warmthBlessing(body));
      drawer.setBody(
        receipt({
          title: editing ? '祝福已重新提交' : '祝福已提交',
          rows: [
            ['祝福编号', payload.blessing.id],
            ['投递方式', payload.blessing.delivery],
            ['当前状态', payload.blessing.status],
          ],
        }),
        notice(payload.message, { tone: payload.blessing.deliveryState === '等待对方加入' ? 'warning' : 'success' }),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      notify.success(editing ? '祝福已重新提交' : '祝福已提交', payload.message, { duration: 7000 });
      onDone?.();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && (error.status === 400 || error.isConflict || error.isRateLimited)) {
        notify.warning('未能提交祝福', error.message);
        return;
      }
      reportError(error, '未能提交祝福');
    }
  }
}
