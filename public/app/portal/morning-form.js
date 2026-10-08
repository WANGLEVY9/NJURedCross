import { h } from '../core/dom.js';
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
    ['公开 QQ', card.publishQQ ? '是' : '否'],
    ['公开微信', card.publishWechat ? '是' : '否'],
    ['公开其他联系方式', card.publishOther ? card.otherContact || '是' : '否'],
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
  const campusField = field({
    label: '校区',
    name: 'campus',
    required: true,
    value: card?.campus || profile.campus || '',
    options: [{ value: '', label: '请选择校区' }, ...CAMPUS_OPTIONS.map((value) => ({ value, label: value }))],
  });
  const tagsField = field({
    label: '兴趣标签',
    name: 'interestTags',
    required: true,
    maxlength: 100,
    value: (card?.interestTags || []).join('、'),
    placeholder: '例如：摄影、跑步、读书、桌游，用逗号分隔',
    hint: '最多 5 个，每个标签不超过 16 字。',
  });
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
  const publishQQ = checkbox({
    name: 'publishQQ',
    label: '公开 QQ',
    checked: Boolean(card?.publishQQ),
    description: profile.qq ? `当前账号 QQ：${profile.qq}` : '账号资料里还没有 QQ，请先去会员中心补充。',
  });
  const publishWechat = checkbox({
    name: 'publishWechat',
    label: '公开微信',
    checked: Boolean(card?.publishWechat),
    description: profile.wechat ? `当前账号微信：${profile.wechat}` : '账号资料里还没有微信，请先去会员中心补充。',
  });
  const otherContactField = field({
    label: '其他联系方式',
    name: 'otherContact',
    maxlength: 100,
    value: card?.otherContact || '',
    placeholder: '例如：邮箱、社群名称或其他你愿意公开的方式',
    hint: '只有勾选公开其他联系方式时才会展示。',
  });
  const publishOther = checkbox({
    name: 'publishOther',
    label: '公开其他联系方式',
    checked: Boolean(card?.publishOther),
    onChange: (checked) => { otherContactField.control.disabled = !checked; },
  });
  otherContactField.control.disabled = !publishOther.control.checked;
  if (!profile.qq) publishQQ.control.disabled = true;
  if (!profile.wechat) publishWechat.control.disabled = true;

  const consent = checkbox({
    name: 'consent',
    label: '我自愿报名，并接受管理员审核',
    description: '审核通过后的名片才会进入广场。第一版仅支持评论互动，不包含点赞。',
  });
  const tagPreview = h('div', { class: 'morning-tag-preview', 'aria-live': 'polite' });
  const updateTags = () => {
    const tags = parseMorningTags(tagsField.control.value);
    tagPreview.replaceChildren(
      h('span', { class: 't-caption t-muted', text: `已填写 ${tags.length}/5` }),
      ...tags.map((tag) => badge(tag, { tone: 'neutral' })),
    );
  };
  tagsField.control.addEventListener('input', updateTags);
  updateTags();

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
    tagsField,
    tagPreview,
    noteField,
    h('div', { class: 'morning-contact-grid' },
      publishQQ,
      publishWechat,
      publishOther,
    ),
    otherContactField,
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
    tagsField.setError(null);
    noteField.setError(null);
    otherContactField.setError(null);
    const nickname = nicknameField.control.value.trim();
    const tags = parseMorningTags(tagsField.control.value);
    const note = noteField.control.value.trim();
    const otherContact = otherContactField.control.value.trim();
    let invalid = null;

    if (!nickname) { nicknameField.setError('请填写昵称'); invalid = nicknameField; }
    if (!campusField.control.value) { campusField.setError('请选择校区'); invalid = invalid || campusField; }
    if (tags.length > 5) { tagsField.setError('兴趣标签最多 5 个'); invalid = invalid || tagsField; }
    if (tags.some((tag) => tag.length > 16)) { tagsField.setError('单个兴趣标签不能超过 16 字'); invalid = invalid || tagsField; }
    if (note.length > 200) { noteField.setError('备注不能超过 200 字'); invalid = invalid || noteField; }
    if (publishOther.control.checked && !otherContact) { otherContactField.setError('请填写要公开的其他联系方式'); invalid = invalid || otherContactField; }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
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
        campus: campusField.control.value,
        interestTags: tags,
        note,
        publishQQ: publishQQ.control.checked,
        publishWechat: publishWechat.control.checked,
        publishOther: publishOther.control.checked,
        otherContact,
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
