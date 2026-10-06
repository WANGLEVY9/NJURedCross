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
  specific: '只送给这个学号对应的同学；对方还没加入计划时会先等待，等他加入后进入审核队列。',
  random: '系统会随机匹配一位已加入计划的同学作为收件人，对方看不到你的联系方式。',
  repository: '这条祝福会进入红会祝福仓库，可以被多次调用，送给不同的同学。',
};
const DELIVERY_KEY_BY_LABEL = { 指定学号: 'specific', 随机匹配: 'random', 祝福仓库: 'repository' };

export function openBlessingDrawer({ blessing = null, onDone } = {}) {
  const editing = Boolean(blessing?.id);
  let delivery = blessing?.deliveryKey || DELIVERY_KEY_BY_LABEL[blessing?.delivery] || 'random';
  const hintId = `blessing-delivery-hint-${Math.random().toString(36).slice(2, 7)}`;

  const nicknameField = field({ label: '你的昵称', name: 'blessingNickname', required: true, maxlength: 40, value: blessing?.nickname || '', placeholder: '其他参与者会看到这个称呼', hint: '这个昵称会展示给收到祝福的同学。' });
  const contentField = field({ label: '祝福内容', name: 'content', multiline: true, rows: 5, maxlength: 1000, required: true, value: blessing?.content || '', placeholder: '写下你想送给同学的生日祝福。提交后会先进入人工审核。' });
  const targetField = field({ label: '对方学号', name: 'targetStudentId', value: blessing?.targetStudentId || '', placeholder: '例如 20220001', hint: '只能指定已经注册平台账号的同学；对方还没加入计划时会先等待。' });
  const deliveryHint = h('p', { class: 't-caption t-secondary', id: hintId, text: DELIVERY_HINTS[delivery] });
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
      deliveryHint.textContent = DELIVERY_HINTS[value];
      targetField.hidden = value !== 'specific';
    },
  });
  targetField.hidden = delivery !== 'specific';

  const consent = checkbox({
    name: 'blessingConsent',
    label: '我确认这段祝福由我本人撰写',
    description: '内容会先经过人工审核，通过后才会转达或被祝福仓库调用。',
  });
  const consentError = h('p', { class: 'field__error', attrs: { role: 'alert' }, hidden: true });
  const fileInput = h('input', { class: 'input', type: 'file', attrs: { accept: '.txt,.md,text/plain,text/markdown', 'aria-label': '从文本文件导入祝福内容' } });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 64 * 1024) {
      notify.warning('文件太大', '请选择不超过 64 KB 的文本文件。');
      fileInput.value = '';
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) { notify.warning('文件为空', '没有读到可用的祝福内容。'); return; }
      contentField.control.value = text.trim().slice(0, 1000);
      contentField.setError(null);
    } catch {
      notify.warning('读取失败', '请确认文件是纯文本格式。');
    }
  });

  const submitButton = button({ label: editing ? '重新提交' : '提交祝福', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '生日祝福',
    title: editing ? '修改生日祝福' : '给同学写一句祝福',
    description: editing ? '仅「需修改」的投稿可以重新提交' : '可以写多次 · 人工审核',
    width: 520,
    body: [
      nicknameField,
      contentField,
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '也可以从文本文件导入' }), fileInput, h('p', { class: 't-caption t-secondary', text: '支持 .txt / .md 文本文档，最大 64 KB；导入后仍可继续编辑。' })),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '这份祝福送给谁' }), deliveryControl),
      deliveryHint,
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
