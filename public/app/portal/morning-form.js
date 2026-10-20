import { h, icon } from '../core/dom.js';
import { morningApi, ApiError } from '../core/api.js';
import { shake } from '../core/motion.js';
import {
  badge,
  button,
  checkbox,
  definitionList,
  field,
  notice,
  runWithLoading,
} from '../ui/primitives.js';
import { segmentedField } from '../ui/segmented-field.js';
import { notify, reportError } from '../core/toast.js';
import { redirectIfAuthError } from './auth-gate.js';

const CAMPUS_OPTIONS = ['鼓楼', '仙林', '苏州', '浦口'];
const TAG_PRESETS = ['摄影', '跑步', '读书', '音乐', '桌游', '旅行', '电影', '编程', '羽毛球', '公益', '健身', '动漫', '咖啡', '博物馆', '志愿'];
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
      h('p', { class: 't-caption t-muted', text: '身份信息来自账号资料，仅本人和管理员可见。' }),
    ),
    definitionList([
      ['真实姓名', profile.realName || '—'],
      ['性别', profile.gender || '—'],
      ['学号', profile.studentId || '—'],
      ['学院', profile.department || '未填写'],
      ['年级', profile.grade || '未填写'],
      ['联系邮箱', profile.email || '—'],
    ]),
  );
}

export function morningCardSummary(card) {
  return definitionList([
    ['昵称', card.nickname || '—'],
    ['性别', card.gender || '—'],
    ['学院', card.showDepartment ? card.department || '未填写' : '不公开'],
    ['年级', card.showGrade ? card.grade || '未填写' : '不公开'],
    ['兴趣标签', card.interestTags.length ? card.interestTags.join('、') : '未填写'],
    ['留言', card.note || '未填写'],
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
    hint: '昵称由你填写并公开展示，请不要使用真实姓名。',
  });
  const campusValue = CAMPUS_OPTIONS.includes(card?.campus)
    ? card.campus
    : (CAMPUS_OPTIONS.includes(profile.campus) ? profile.campus : '');
  const campusField = segmentedField({
    name: 'campus',
    label: '校区',
    options: CAMPUS_OPTIONS.map((value) => ({ value, label: value })),
    value: campusValue,
    required: true,
    hint: '选择你主要活动的校区。',
  });
  const selectedTags = [...new Set((card?.interestTags || []).map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 5);
  let availableTags = [...TAG_PRESETS];
  let libraryTags = [];
  const noteField = field({
    label: '留言',
    name: 'note',
    multiline: true,
    rows: 4,
    maxlength: 100,
    value: card?.note || '',
    placeholder: '写下你希望别人了解的自我介绍、想找的搭子或近期期待。',
    hint: '最多 100 字，审核通过后会出现在名片详情页。',
  });
  const emailField = field({
    label: '通知邮箱',
    name: 'email',
    value: profile.email || '',
    readonly: true,
    hint: '使用会员中心已绑定的邮箱；如需修改，请前往会员中心。',
  });
  const showDepartment = checkbox({
    name: 'showDepartment',
    label: `公开展示学院${profile.department ? `：${profile.department}` : ''}`,
    description: profile.department
      ? '关闭后，广场卡片和详情页都不会返回你的学院。'
      : '账号资料尚未填写学院，暂时无法公开展示。',
    checked: Boolean(profile.department) && card?.showDepartment === true,
    disabled: !profile.department,
  });
  const showGrade = checkbox({
    name: 'showGrade',
    label: `公开展示年级${profile.grade ? `：${profile.grade}` : ''}`,
    description: profile.grade
      ? '关闭后，广场卡片和详情页都不会返回你的年级。'
      : '账号资料尚未填写年级，暂时无法公开展示。',
    checked: Boolean(profile.grade) && card?.showGrade === true,
    disabled: !profile.grade,
  });
  const consent = checkbox({
    name: 'consent',
    label: '我自愿报名，并接受管理员审核',
    description: '审核通过后的名片才会进入广场，请遵守友善交流与隐私保护约定。',
  });
  const selectedTagsNode = h('div', { class: 'morning-tag-picker__selected' });
  const tagSuggestions = h('div', { class: 'morning-tag-picker__suggestions' });
  const tagSearch = field({
    label: '搜索或新建标签',
    name: 'tagSearch',
    placeholder: '输入兴趣标签，例如摄影、跑步',
    hint: '从预设中选择；搜不到时可以新建词条。最多 5 个，每个不超过 5 字。',
  });
  const tagError = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const tagCount = h('span', { class: 't-caption t-muted', 'aria-live': 'polite' });
  const updateTagState = () => {
    tagCount.textContent = `已选择 ${selectedTags.length}/5`;
    tagError.hidden = selectedTags.length > 0;
    selectedTagsNode.replaceChildren(
      ...(selectedTags.length
        ? selectedTags.map((tag) => h(
            'button',
            {
              class: 'morning-tag-picker__selected-tag',
              type: 'button',
              attrs: { 'aria-label': `移除 ${tag}` },
              on: { click: () => removeTag(tag) },
            },
            h('span', { text: tag }),
            icon('close', 'ico ico--sm'),
          ))
        : [h('p', { class: 't-caption t-muted', text: '还没有选择标签' })]),
    );
    const query = tagSearch.control.value.trim();
    const normalized = query.toLowerCase();
    const selected = new Set(selectedTags.map((tag) => tag.toLowerCase()));
    const matches = query
      ? availableTags.filter((tag) => !selected.has(tag.toLowerCase()) && tag.toLowerCase().includes(normalized)).slice(0, 8)
      : [
          ...libraryTags,
          ...TAG_PRESETS,
        ].filter((tag, index, list) => (
          !selected.has(tag.toLowerCase())
          && list.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) === index
        )).slice(0, 12);
    const exact = availableTags.find((tag) => tag.toLowerCase() === normalized);
    const nodes = matches.map((tag) => h(
      'button',
      { class: 'morning-tag-picker__preset', type: 'button', on: { click: () => { addTags(tag); tagSearch.control.value = ''; updateTagState(); } } },
      icon('plus', 'ico ico--sm'),
      h('span', { text: tag }),
    ));
    if (query && !exact && !selected.has(normalized)) {
      const tooLong = query.length > 5;
      nodes.push(h(
        'button',
        {
          class: 'morning-tag-picker__create',
          type: 'button',
          disabled: tooLong || undefined,
          on: { click: () => { addTags(query, { persist: true }); tagSearch.control.value = ''; updateTagState(); } },
        },
        icon('plus', 'ico ico--sm'),
        h('span', { text: tooLong ? '标签最多 5 个字' : `新建词条：${query}` }),
      ));
    }
    tagSuggestions.replaceChildren(...nodes);
  };
  const rememberTag = (tag, { custom = false } = {}) => {
    if (!availableTags.some((item) => item.toLowerCase() === tag.toLowerCase())) availableTags.push(tag);
    if (custom) {
      libraryTags = [tag, ...libraryTags.filter((item) => item.toLowerCase() !== tag.toLowerCase())];
    }
  };
  const persistTag = async (tag) => {
    rememberTag(tag, { custom: true });
    try {
      await morningApi.createTag(tag);
    } catch (error) {
      notify.warning('标签库暂未同步', error.message || tag);
    }
  };
  const addTags = (raw, { persist = false } = {}) => {
    const parts = String(raw || '').split(/[,，、\n]+/).map((item) => item.trim()).filter(Boolean);
    for (const tag of parts) {
      if (tag.length > 5) {
        tagError.hidden = false;
        tagError.textContent = '单个兴趣标签不能超过 5 字';
        return;
      }
      if (selectedTags.some((item) => item.toLowerCase() === tag.toLowerCase())) continue;
      if (selectedTags.length >= 5) {
        notify.info('5 个标签已经填满', '可以移除一个标签后再添加。');
        return;
      }
      selectedTags.push(tag);
      rememberTag(tag);
      if (persist) void persistTag(tag);
      tagError.hidden = true;
    }
  };
  const removeTag = (tag) => {
    const index = selectedTags.indexOf(tag);
    if (index >= 0) selectedTags.splice(index, 1);
    updateTagState();
    tagSearch.control.focus();
  };
  tagSearch.control.addEventListener('input', updateTagState);
  tagSearch.control.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const query = tagSearch.control.value.trim();
    if (!query) return;
    const exact = availableTags.find((tag) => tag.toLowerCase() === query.toLowerCase());
    addTags(exact || query, { persist: !exact });
    tagSearch.control.value = '';
    updateTagState();
  });
  updateTagState();
  morningApi.tags()
    .then((payload) => {
      for (const tag of payload.tags || []) {
        rememberTag(tag, { custom: !TAG_PRESETS.includes(tag) });
      }
      updateTagState();
    })
    .catch(() => {});

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
    h('div', { class: 'morning-form__grid' }, nicknameField, campusField),
    h('div', { class: 'field' },
      h('p', { class: 'field__label', text: '公开资料范围' }),
      h('p', { class: 'field__hint', text: '昵称由你填写；性别固定展示；学院和年级由你决定是否公开。' }),
      showDepartment,
      showGrade,
    ),
    h(
      'div',
      { class: 'field morning-tags-field' },
      h('p', { class: 'field__label' }, h('span', { text: '兴趣标签' }), h('span', { class: 'field__req', text: '必填' })),
      h('p', { class: 'field__hint', text: '搜索预设标签，或输入后新建词条。最多 5 个，每个不超过 5 字。' }),
      selectedTagsNode,
      tagSearch,
      tagSuggestions,
      h('div', { class: 'row-between' }, tagCount, tagError),
    ),
    noteField,
    emailField,
    notice('个人名片不会展示任何联系方式。好友邀约只通过校园邮箱发送，不会在广场公开。', {
      tone: 'info',
      title: '隐私说明',
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
    tagError.hidden = true;
    noteField.setError(null);
    const nickname = nicknameField.control.value.trim();
    const tags = [...selectedTags];
    const note = noteField.control.value.trim();
    let invalid = null;

    if (!nickname) { nicknameField.setError('请填写昵称'); invalid = nicknameField; }
    if (!campusField.getValue()) { campusField.setError('请选择校区'); invalid = invalid || campusField; }
    if (!tags.length) {
      tagError.hidden = false;
      tagError.textContent = '请至少填写一个兴趣标签';
      invalid = invalid || tagSearch;
    }
    if (tags.some((tag) => tag.length > 5)) {
      tagError.hidden = false;
      tagError.textContent = '单个兴趣标签不能超过 5 字';
      invalid = invalid || tagSearch;
    }
    if (note.length > 100) { noteField.setError('留言不能超过 100 字'); invalid = invalid || noteField; }
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
        campus: campusField.getValue(),
        interestTags: tags,
        note,
        showDepartment: showDepartment.control.checked,
        showGrade: showGrade.control.checked,
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
