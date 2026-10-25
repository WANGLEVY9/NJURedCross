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
import { deleteWrittenBlessing } from './blessing-actions.js';
import { birthdayMonthOptions, birthdayDayOptions, bindBirthdayMonthDay, BIRTHDAY_CALENDAR_OPTIONS, BIRTHDAY_CALENDAR_HINT, birthdayLabel } from './warmth-options.js';

const DELIVERY_HINTS = {
  random: '系统会随机匹配一位已加入计划的同学作为收件人，对方看不到你的联系方式。随机匹配与祝福仓库的投稿，都会为你换取等量的一对一祝福。',
  repository: '审核通过后，它会住进红会祝福库，一次次被送到不同的同学手中，也会为你换回等量的一对一祝福。谢谢你留下这份温柔。',
  friend: '填写挚友昵称、生日历法和邮箱。经审核后，在下一次生日当天通过邮件发送一次；挚友无需注册。此类祝福不占 3 条投稿额度，不进入随机匹配池，也不增加一对一额度。',
};
const DELIVERY_KEY_BY_LABEL = { 随机匹配: 'random', 祝福仓库: 'repository', 写给挚友: 'friend' };
const REPOSITORY_USED_HINT = '你已写过一条祝福仓库（每人限一条）；如需调整，请在会员中心「我写的生日祝福」里修改。';

export function openBlessingDrawer({ blessing = null, onDone } = {}) {
  const editing = Boolean(blessing?.id);
  let delivery = blessing?.deliveryKey || DELIVERY_KEY_BY_LABEL[blessing?.delivery] || 'random';
  let repositoryUsed = false;
  const hintId = `blessing-delivery-hint-${Math.random().toString(36).slice(2, 7)}`;

  const nicknameField = field({ label: '你的昵称', name: 'blessingNickname', required: true, maxlength: 40, value: blessing?.nickname || '', placeholder: '其他参与者会看到这个称呼', hint: '这个昵称会展示给收到祝福的同学。' });
  const contentField = field({ label: '祝福内容', name: 'content', multiline: true, rows: 5, maxlength: 200, required: true, value: blessing?.content || '', placeholder: '写下你想送给同学的生日祝福。提交后会先进入人工审核。', hint: '不超过 200 字。' });
  const contentHint = contentField.querySelector('.field__hint');
  function updateContentCount() {
    contentHint.textContent = `不超过 200 字 · 已输入 ${contentField.control.value.length} / 200 字`;
    if (contentField.control.value.trim().length <= 200) contentField.setError(null);
  }
  contentField.control.addEventListener('input', updateContentCount);
  updateContentCount();
  const [friendMonth = '01', friendDay = '01'] = String(blessing?.friendBirthday || '01-01').split('-');
  const friendNicknameField = field({ label: '挚友昵称', name: 'friendNickname', required: true, maxlength: 40, value: blessing?.friendNickname || '', placeholder: '这封祝福想送给谁' });
  const friendCalendarField = field({ label: '挚友生日历法', name: 'friendBirthdayCalendar', options: BIRTHDAY_CALENDAR_OPTIONS, value: blessing?.friendBirthdayCalendar || 'solar', hint: BIRTHDAY_CALENDAR_HINT });
  const friendEmailField = field({ label: '挚友邮箱', name: 'friendEmail', type: 'email', required: true, maxlength: 254,
    value: blessing?.friendEmail || '', placeholder: '填写挚友接收祝福的邮箱', hint: '仅用于这次生日祝福，不向其他参与者公开。' });
  const friendMonthField = field({ label: '挚友生日（月）', name: 'friendBirthdayMonth', required: true, value: friendMonth,
    options: birthdayMonthOptions(blessing?.friendBirthdayCalendar) });
  const friendDayField = field({ label: '挚友生日（日）', name: 'friendBirthdayDay', required: true, value: friendDay,
    options: birthdayDayOptions(friendMonth, blessing?.friendBirthdayCalendar) });
  bindBirthdayMonthDay(friendMonthField.control, friendDayField.control, friendCalendarField.control);
  const friendDetails = h('div', { class: 'stack-4', hidden: delivery !== 'friend' }, friendNicknameField, friendEmailField, friendCalendarField,
    h('div', { class: 'formgrid' }, friendMonthField, friendDayField),
    notice('只需填写月、日，不收集出生年份。请核对邮箱；生日已过会安排下一年，2 月 29 日安排到下一个闰年。审核未及时通过或当日服务不可用时可能错过投递，不会在其他日期补发。', { tone: 'info' }));
  const deliveryHint = h('p', { class: 't-caption t-secondary blessing-delivery-hint', id: hintId, text: DELIVERY_HINTS[delivery] });
  const deliveryControl = segmented({
    items: [
      { value: 'random', label: '随机匹配' },
      { value: 'repository', label: '祝福仓库' },
      { value: 'friend', label: '写给挚友' },
    ],
    value: delivery,
    ariaLabel: '投递方式',
    describedBy: hintId,
    role: 'radiogroup',
    onChange: (value) => {
      delivery = value;
      deliveryControl.setValue(value);
      friendDetails.hidden = value !== 'friend';
      deliveryHint.textContent = value === 'repository' && repositoryUsed ? REPOSITORY_USED_HINT : DELIVERY_HINTS[value];
    },
  });
  // 祝福仓库每人限一条：提前取一次自己的投稿用于前端提示（服务端仍会兜底拦截）
  if (!editing) {
    void publicApi.myWarmthBlessings()
      .then((payload) => {
        repositoryUsed = (payload.blessings || []).some((item) => item.deliveryKey === 'repository' && item.status !== '已拒绝');
        const occupied = (payload.blessings || []).filter(item => item.status !== '已拒绝' && item.deliveryKey !== 'friend' && item.delivery !== '写给挚友').length;
        if (occupied >= (Number(payload.stats?.limit) || 3)) {
          delivery = 'friend'; deliveryControl.setValue('friend'); friendDetails.hidden = false;
          deliveryHint.textContent = DELIVERY_HINTS.friend;
        }
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
      friendDetails,
      notice('收件规则：「随机匹配」和「祝福仓库」的投稿，都会为你换取等量的一对一祝福。祝福仓库每个账号只能投稿一条。', { tone: 'info' }),
      consent,
      consentError,
    ],
    footer: [
      editing && blessing.status !== '已拒绝'
        ? button({
            label: '删除',
            variant: 'danger',
            onClick: async () => {
              const deleted = await deleteWrittenBlessing(blessing, { onChanged: onDone });
              if (deleted) drawer.close();
            },
          })
        : null,
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ].filter(Boolean),
  });

  async function submit() {
    nicknameField.setError(null);
    contentField.setError(null);
    consentError.hidden = true;
    consent.control.removeAttribute('aria-invalid');
    if (!nicknameField.control.value.trim()) { nicknameField.setError('请填写昵称'); shake(nicknameField); nicknameField.control.focus(); return; }
    if (!contentField.control.value.trim()) { contentField.setError('请写下祝福内容'); shake(contentField); contentField.control.focus(); return; }
    if (contentField.control.value.trim().length > 200) { contentField.setError('祝福内容不能超过 200 字'); shake(contentField); contentField.control.focus(); return; }
    friendEmailField.setError(null);
    friendMonthField.setError(null);
    friendDayField.setError(null);
    if (delivery === 'friend') {
      friendNicknameField.setError(null);
      if (!friendNicknameField.control.value.trim()) { friendNicknameField.setError('请填写挚友昵称'); friendNicknameField.control.focus(); return; }
      if (!friendEmailField.control.value.trim() || !friendEmailField.control.checkValidity()) {
        friendEmailField.setError('请填写有效的挚友邮箱'); friendEmailField.control.focus(); return;
      }
      if (!friendMonthField.control.value) { friendMonthField.setError('请选择挚友生日月份'); friendMonthField.control.focus(); return; }
      if (!friendDayField.control.value) { friendDayField.setError('请选择挚友生日日期'); friendDayField.control.focus(); return; }
    }
    if (!editing && delivery === 'repository' && repositoryUsed) {
      deliveryHint.textContent = REPOSITORY_USED_HINT;
      notify.warning('祝福仓库每人限一条', '你已写过一条祝福仓库；可在会员中心修改它，或改为随机匹配。');
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
      consent: true,
      ...(delivery === 'friend' ? { friendNickname: friendNicknameField.control.value.trim(), friendBirthdayCalendar: friendCalendarField.control.value, friendEmail: friendEmailField.control.value.trim(),
        friendBirthday: `${friendMonthField.control.value}-${friendDayField.control.value}` } : {}),
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
            ...(delivery === 'friend' ? [['挚友昵称', body.friendNickname], ['挚友生日', birthdayLabel({ birthdayCalendar: body.friendBirthdayCalendar, birthdayMonthDay: body.friendBirthday })], ['收件邮箱', body.friendEmail],
              ['发送安排', payload.blessing.scheduledDate ? `${payload.blessing.scheduledDate}，发送一次（须先通过审核）` : '下一次生日当天发送一次（须先通过审核）']] : []),
          ],
        }),
        notice(payload.message, { tone: 'success' }),
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
