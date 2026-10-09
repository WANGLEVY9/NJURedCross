import { h } from '../core/dom.js';
import { morningApi, ApiError } from '../core/api.js';
import { shake } from '../core/motion.js';
import {
  badge,
  button,
  checkbox,
  chip,
  definitionList,
  field,
  notice,
  runWithLoading,
  segmented,
} from '../ui/primitives.js';
import { notify, reportError } from '../core/toast.js';
import { redirectIfAuthError } from './auth-gate.js';

const CAMPUS_OPTIONS = ['鼓楼', '仙林', '苏州', '浦口'];
const STATUS_TONE = {
  待审核: 'warning',
  需修改: 'warning',
  已发布: 'success',
  已拒绝: 'error',
  已下架: 'neutral',
};

export function parseMorningTags(value) {
  return [...new Set(String(value || '')
    .split(/[,，、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function morningStatusBadge(status) {
  return badge(status || '待审核', { tone: STATUS_TONE[status] || 'neutral' });
}

export function morningIdentityPanel(profile) {
  return h(
    'section',
    { class: 'morning-identity' },
    h('div', { class: 'stack-2' },
      h('p', { class: 't-label', text: '报名身份' }),
      h('p', { class: 't-caption t-muted', text: '以下三项强绑定账号资料，不能在报名表里修改。' }),
    ),
    definitionList([
      ['真实姓名', profile.realName || '—'],
      ['性别', profile.gender || '—'],
      ['学号', profile.studentId || '—'],
      ['联系邮箱', profile.email || '—'],
    ]),
  );
}

export function morningCardSummary(card) {
  return definitionList([
    ['昵称', card.nickname || '—'],
    ['兴趣标签', card.interestTags.length ? card.interestTags.join('、') : '未填写'],
    ['备注', card.note || '未填写'],
    ['提交时间', card.submittedAt || '—'],
    ['审核意见', card.reviewNote || '—'],
  ]);
}

export function buildMorningSignupForm({ profile, card, onSubmitted }) {
  const nicknameField = field({
    label: '昵称',
    name: 'nickname',
    required: true,
    maxlength: 40,
    value: card?.nickname || '',
    placeholder: '其他同学在广场上看到的称呼',
    hint: '昵称会公开显示，请不要填写真实姓名。',
  });
  let campusValue = CAMPUS_OPTIONS.includes(card?.campus)
    ? card.campus
    : (CAMPUS_OPTIONS.includes(profile.campus) ? profile.campus : '');
  const campusErrorId = 'morning-campus-error';
  const campusError = h('p', { class: 'field__error', id: campusErrorId, role: 'alert', hidden: true });
  const campusControl = segmented({
    items: CAMPUS_OPTIONS.map((value) => ({ value, label: value })),
    value: campusValue,
    ariaLabel: '校区',
    role: 'radiogroup',
    describedBy: campusErrorId,
    onChange: (value) => {
      campusValue = value;
      campusError.hidden = true;
      campusControl.setValue(value);
    },
  });
  const campusField = h(
    'div',
    { class: 'field morning-campus-field', data: { fieldName: 'campus' } },
    h('p', { class: 'field__label' }, h('span', { text: '校区' }), h('span', { class: 'field__req', text: '必填' })),
    campusControl,
    h('p', { class: 'field__hint', text: '选择你主要活动的校区。' }),
    campusError,
  );
  campusField.setError = (message) => {
    if (message) {
      campusError.textContent = message;
      campusError.hidden = false;
      campusControl.setAttribute('aria-invalid', 'true');
    } else {
      campusError.textContent = '';
      campusError.hidden = true;
      campusControl.removeAttribute('aria-invalid');
    }
  };
  campusField.focus = () => campusControl.querySelector('button')?.focus();
  const tagFields = Array.from({ length: 5 }, (_, index) => field({
    label: `标签 ${index + 1}`,
    name: `interestTag${index + 1}`,
    maxlength: 16,
    value: card?.interestTags?.[index] || '',
    placeholder: index === 0 ? '至少填写一个' : '选填',
  }));
  const noteField = field({
    label: '备注',
    name: 'note',
    multiline: true,
    rows: 4,
    maxlength: 200,
    value: card?.note || '',
    placeholder: '写下你希望别人了解的自我介绍、想找的搭子或近期期待。',
    hint: '最多 200 字，审核通过后会出现在名片详情页。',
  });
  const emailField = field({
    label: '通知邮箱',
    name: 'email',
    value: profile.email || '',
    readonly: true,
    hint: '来自个人中心，默认使用 smail.nju.edu.cn 且不可修改。',
  });
  const allowEmail = checkbox({
    name: 'allowEmail',
    label: '允许别人通过评论邮件通知我',
    description: '评论仍会公开显示；关闭后，别人给这张名片评论时不会给你发邮件。',
    checked: card?.allowEmail !== false,
  });
  const consent = checkbox({
    name: 'consent',
    label: '我自愿报名，并接受管理员审核',
    description: '审核通过后的名片才会进入广场。第一版仅支持评论互动，不包含点赞。',
  });
  const tagError = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const tagCount = h('span', { class: 't-caption t-muted', 'aria-live': 'polite' });
  const tagSamples = ['摄影', '跑步', '读书', '音乐', '桌游', '旅行', '电影', '编程', '羽毛球', '公益'];
  const updateTagState = () => {
    const tags = [...new Set(tagFields.map((item) => item.control.value.trim()).filter(Boolean))];
    tagCount.textContent = `已填写 ${tags.length}/5`;
    tagError.hidden = tags.length > 0;
  };
  const tagSampleButtons = tagSamples.map((tag) => chip(tag, {
    onClick: () => {
      const empty = tagFields.find((item) => !item.control.value.trim());
      if (!empty) {
        notify.info('5 个标签已经填满', '可以修改或清空其中一个后再选择样例。');
        return;
      }
      empty.control.value = tag;
      updateTagState();
      empty.control.focus();
    },
  }));
  tagFields.forEach((item) => item.control.addEventListener('input', updateTagState));
  updateTagState();

  const submitButton = button({
    label: card ? '重新提交报名' : '提交报名',
    variant: 'primary',
    iconName: 'arrowRight',
    iconMotion: 'nudge',
    onClick: () => submit(),
  });

  const form = h(
    'form',
    {
      class: 'morning-form',
      on: { submit: (event) => { event.preventDefault(); submit(); } },
    },
    morningIdentityPanel(profile),
    h('div', { class: 'morning-form__grid' },
      nicknameField,
      campusField,
    ),
    h(
      'div',
      { class: 'field morning-tags-field' },
      h('p', { class: 'field__label' }, h('span', { text: '兴趣标签' }), h('span', { class: 'field__req', text: '必填' })),
      h('p', { class: 'field__hint', text: '最多 5 个，每个不超过 16 字；至少填写一个。' }),
      h('div', { class: 'morning-tags__samples' }, h('span', { class: 't-caption t-muted', text: '可点击样例：' }), ...tagSampleButtons),
      h('div', { class: 'morning-tags__grid' }, ...tagFields),
      h('div', { class: 'row-between' }, tagCount, tagError),
    ),
    noteField,
    emailField,
    allowEmail,
    notice('个人名片不会展示任何联系方式。如允许评论邮件，别人评论时平台会发送邮件到你的账号邮箱。', {
      tone: 'info',
      title: '评论通知',
    }),
    consent,
    h('div', { class: 'morning-form__actions' },
      h('p', { class: 't-caption t-muted', text: '提交后状态为“待审核”，审核通过后才会进入广场。' }),
      h('span', { class: 'spacer' }),
      submitButton,
    ),
  );

  async function submit() {
    nicknameField.setError(null);
    campusField.setError(null);
    tagFields.forEach((item) => item.setError(null));
    tagError.hidden = true;
    noteField.setError(null);
    const nickname = nicknameField.control.value.trim();
    const tags = [...new Set(tagFields.map((item) => item.control.value.trim()).filter(Boolean))];
    const note = noteField.control.value.trim();
    let invalid = null;

    if (!nickname) { nicknameField.setError('请填写昵称'); invalid = nicknameField; }
    if (!campusValue) { campusField.setError('请选择校区'); invalid = invalid || campusField; }
    if (!tags.length) {
      tagError.hidden = false;
      tagError.textContent = '请至少填写一个兴趣标签';
      invalid = invalid || tagFields[0];
    }
    if (tags.some((tag) => tag.length > 16)) {
      tagError.hidden = false;
      tagError.textContent = '单个兴趣标签不能超过 16 字';
      invalid = invalid || tagFields.find((item) => item.control.value.trim().length > 16);
    }
    if (note.length > 200) { noteField.setError('备注不能超过 200 字'); invalid = invalid || noteField; }
    if (invalid) {
      shake(invalid);
      if (invalid.focus) invalid.focus();
      else invalid.control?.focus?.();
      return;
    }
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要确认报名规则', '请先勾选自愿报名并接受审核。');
      return;
    }

    try {
      const payload = await runWithLoading(submitButton, () => morningApi.submitCard({
        nickname,
        campus: campusValue,
        interestTags: tags,
        note,
        allowEmail: allowEmail.control.checked,
        consent: true,
      }));
      notify.success('报名已提交', payload.message);
      onSubmitted(payload.card);
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && (error.status === 400 || error.status === 409 || error.status === 429)) {
        notify.warning('报名未提交', error.message);
        return;
      }
      reportError(error, '报名未提交');
    }
  }

  form.submit = submit;
  return form;
}
