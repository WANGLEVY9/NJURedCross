import { h } from '../core/dom.js';
import { request } from '../core/api.js';
import { reportError, notify } from '../core/toast.js';
import { button, field, notice, runWithLoading, segmented } from '../ui/primitives.js';
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
  const categoryError = h('p', {
    class: 'field__error',
    id: 'feedback-category-error',
    attrs: { role: 'alert', 'aria-live': 'polite' },
    hidden: true,
  });
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
      if (!text) {
        content.setError('请填写反馈意见。');
        content.control.focus();
        return;
      }
      if (count > MAX_LENGTH) {
        content.control.focus();
        return;
      }
      try {
        const result = await request('/api/public/feedback', {
          method: 'POST',
          body: { category, content: text },
        });
        notify.success('反馈已提交', result.message, { duration: 5000 });
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
      notice('反馈会直接进入管理端的问题反馈列表。请勿填写密码、身份证号等敏感信息。', { tone: 'info' }),
      h('div', { class: 'feedback-compose' },
        h('div', { class: 'feedback-compose__field', data: { feedbackCategory: 'true' } },
          h('p', { class: 'field__label' }, h('span', { text: '问题分类' }), h('span', { class: 'field__req', text: '必选' })),
          categoryTabs,
          categoryError),
        content,
        counter,
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
