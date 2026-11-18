import { h } from '../core/dom.js';
import { request, getSessionState } from '../core/api.js';
import { reportError, notify } from '../core/toast.js';
import { button, field, notice, readonlyField, runWithLoading, segmented } from '../ui/primitives.js';
import { openDrawer } from '../ui/overlay.js';

const CATEGORIES = ['活动', '物资', '内建', '宣传', '其他'];
const MAX_LENGTH = 200;

let activeDrawer = null;

export function openFeedbackDrawer() {
  if (activeDrawer) {
    activeDrawer.surface.querySelector('[data-feedback-category]')?.focus();
    return activeDrawer;
  }

  let category = '';
  let activityId = '';
  let activityField = null;
  let activityLoading = false;
  let activitiesLoaded = false;
  const session = getSessionState();
  const accountEmail = session.user?.notificationEmail || session.user?.email || '';
  const categoryError = h('p', {
    class: 'field__error',
    id: 'feedback-category-error',
    attrs: { role: 'alert', 'aria-live': 'polite' },
    hidden: true,
  });
  const activitySlot = h('div', { class: 'feedback-compose__activity', hidden: true });
  const categoryTabs = segmented({
    items: CATEGORIES.map((value) => ({ value, label: value })),
    value: category,
    ariaLabel: '问题分类',
    describedBy: 'feedback-category-error',
    role: 'radiogroup',
    onChange: (value) => {
      category = value;
      categoryTabs.setValue(value);
      categoryTabs.dataset.selected = value;
      categoryError.hidden = true;
      activitySlot.hidden = value !== '活动';
      if (value === '活动') void ensureActivities();
    },
  });
  categoryTabs.dataset.selected = '';
  categoryTabs.querySelector('[role="radio"]')?.setAttribute('data-autofocus', 'true');

  const content = field({
    label: '反馈意见',
    name: 'feedback-content',
    multiline: true,
    rows: 6,
    required: true,
    placeholder: '请具体描述你遇到的问题或建议，最多 200 字',
  });
  const resultEmail = session.authenticated
    ? readonlyField({
      label: '处理结果接收邮箱',
      name: 'feedback-result-email',
      value: accountEmail,
      hint: '管理员完成处理后，解决方案会发送到该邮箱。',
      iconName: 'mail',
    })
    : field({
      label: '处理结果接收邮箱',
      name: 'feedback-result-email',
      type: 'email',
      required: true,
      autocomplete: 'email',
      inputmode: 'email',
      placeholder: 'name@smail.nju.edu.cn',
      hint: '管理员完成处理后，解决方案会发送到该邮箱。',
    });
  const counter = h('p', {
    class: 'feedback-compose__counter t-caption',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  const formError = h('div', { aria: { live: 'polite' } });
  const charCount = () => Array.from(content.control.value || '').length;
  const syncCounter = () => {
    const count = charCount();
    counter.textContent = `${count} / ${MAX_LENGTH} 字`;
    counter.dataset.limit = count >= MAX_LENGTH ? 'reached' : '';
    content.setError(count > MAX_LENGTH ? `反馈意见不能超过 ${MAX_LENGTH} 字。` : '');
  };
  content.control.addEventListener('input', syncCounter);
  syncCounter();

  async function ensureActivities() {
    if (activityLoading || activitiesLoaded) return;
    activityLoading = true;
    activitySlot.replaceChildren(notice('正在读取可反馈的活动…', { tone: 'neutral' }));
    try {
      const result = await request('/api/public/feedback/activities');
      const activities = Array.isArray(result.activities) ? result.activities : [];
      if (!activities.length) {
        activitySlot.replaceChildren(notice('当前没有可供选择的活动。', { tone: 'warning' }));
        return;
      }
      const options = [
        { value: '', label: '请选择活动', disabled: true },
        ...activities.map((activity) => ({
          value: activity.id,
          label: [
            activity.name,
            activity.startAt ? String(activity.startAt).slice(0, 10) : '',
            activity.status || '',
          ].filter(Boolean).join(' · '),
        })),
      ];
      activityField = field({
        label: '关联活动',
        name: 'feedback-activity',
        options,
        value: activityId,
        required: true,
        searchable: true,
        hint: '反馈提交后会直接发送给该活动的负责人。',
        onInput: (event) => {
          activityId = event.target.value;
          activityField?.setError('');
        },
      });
      activitySlot.replaceChildren(activityField);
      activitiesLoaded = true;
    } catch (error) {
      activitySlot.replaceChildren(
        notice(error.message || '活动列表暂时无法读取。', { tone: 'error', title: '无法选择活动' }),
        button({ label: '重新读取活动', variant: 'secondary', size: 'sm', onClick: () => ensureActivities() }),
      );
    } finally {
      activityLoading = false;
    }
  }

  let drawer;
  const submit = button({
    label: '提交反馈',
    variant: 'primary',
    iconName: 'send',
    onClick: () => runWithLoading(submit, async () => {
      const text = content.control.value.trim();
      const count = Array.from(text).length;
      content.setError(count > MAX_LENGTH ? `反馈意见不能超过 ${MAX_LENGTH} 字。` : '');
      formError.replaceChildren();
      if (!category) {
        categoryError.hidden = false;
        categoryError.replaceChildren('请先选择问题分类。');
        categoryTabs.querySelector('[role="radio"]')?.focus();
        return;
      }
      if (category === '活动' && (!activityId || !activityField)) {
        activityField?.setError('请选择反馈对应的活动。');
        activityField?.control.focus();
        if (!activityField) {
          formError.replaceChildren(notice('活动列表尚未加载完成，请稍后重试。', { tone: 'warning' }));
        }
        return;
      }
      if (!text) {
        content.setError('请填写反馈意见。');
        content.control.focus();
        return;
      }
      if (count > MAX_LENGTH) {
        content.control.focus();
        return;
      }
      if (!session.authenticated && !resultEmail.control.reportValidity()) {
        resultEmail.control.focus();
        return;
      }
      try {
        const result = await request('/api/public/feedback', {
          method: 'POST',
          body: {
            category,
            content: text,
            ...(category === '活动' ? { activityId } : {}),
            ...(!session.authenticated ? { contactEmail: resultEmail.control.value } : {}),
          },
        });
        if (result.notification?.required && !result.notification.ok) {
          notify.warning('反馈已记录，但负责人邮件暂未送达', result.message, { duration: 7000 });
        } else {
          notify.success('反馈已提交', result.message, { duration: 5000 });
        }
        drawer.close();
      } catch (error) {
        formError.replaceChildren(notice(error.message || '反馈未提交，请稍后重试。', {
          tone: 'error',
          title: '提交未完成',
        }));
        reportError(error, '反馈未提交');
      }
    }),
  });

  drawer = openDrawer({
    eyebrow: '南京大学红十字会 · 问题反馈',
    title: '告诉我们哪里可以做得更好',
    description: '请选择问题所属分类，再填写具体意见。',
    width: 560,
    body: [
      notice('活动类反馈会直接发送给所选活动的负责人；管理员完成后，解决方案会发送到你填写的处理结果接收邮箱。请勿填写密码、身份证号等敏感信息。', { tone: 'info' }),
      h('div', { class: 'feedback-compose' },
        h('div', { class: 'feedback-compose__field', data: { feedbackCategory: 'true' } },
          h('p', { class: 'field__label' }, h('span', { text: '问题分类' }), h('span', { class: 'field__req', text: '必选' })),
          categoryTabs,
          categoryError),
        activitySlot,
        content,
        counter,
        resultEmail,
        formError),
    ],
    footer: [
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      h('span', { class: 'spacer' }),
      submit,
    ],
    onClose: () => { activeDrawer = null; },
  });
  activeDrawer = drawer;
  return drawer;
}
