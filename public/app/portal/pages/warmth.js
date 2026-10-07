/* ==========================================================================
   portal/pages/warmth.js
   Task: understand what "温暖连接" actually does before opting in.
   Consent is the product here, so the guarantees come before the form.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { shake, stagger } from '../../core/motion.js';
import { openDrawer } from '../../ui/overlay.js';
import { navigate } from '../../core/router.js';
import { button, field, checkbox, notice, receipt, badge, segmented, timeline, runWithLoading, copyableCode } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { isSignedIn, loginHref, redirectIfAuthError } from '../auth-gate.js';

const PROGRAMS = [
  {
    id: 'birthday',
    name: '生日祝福',
    iconName: 'sparkle',
    summary: '在你的生日当天收到来自红会同学的手写祝福。祝福由其他同学投稿、经人工审核后转达，对你匿名、对管理员可追溯。',
    collects: ['显示昵称', '生日的月和日（不需要年份）', '联系邮箱', '希望接收的频率'],
    never: ['不读取成员表中的已有生日', '不收集手机号、微信或 QQ', '不把你的邮箱交给投稿人'],
  },
  {
    id: 'morning',
    name: '早安晚安 · 同行计划',
    iconName: 'handshake',
    summary: '以 7 天为一期的轻量同伴陪伴。系统按校区、时段与兴趣给出推荐，由管理员人工确认批次，问候统一由平台转达。',
    collects: ['显示昵称', '校区与可联系时段', '兴趣标签（可选）', '联系邮箱'],
    never: ['首版不交换微信、QQ 或手机号', '不使用不可解释的自动匹配', '不会在你退出后继续发送'],
  },
];

function openJoinDrawer(program, { onDone }) {
  let frequency = 'weekly';

  const nicknameField = field({ label: '显示昵称', name: 'nickname', required: true, placeholder: '其他参与者会看到这个称呼', iconName: 'user' });
  const emailField = field({ label: '联系邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', placeholder: 'your_id@smail.nju.edu.cn', hint: '平台只用它转达内容与发送退出确认。' });
  const campusField = field({ label: '校区', name: 'campus', placeholder: '鼓楼 / 仙林 / 苏州' });
  const birthdayField =
    program.id === 'birthday'
      ? field({ label: '生日（月-日）', name: 'birthdayMonthDay', placeholder: '例如 03-18', hint: '只需要月和日，不需要出生年份。', maxlength: 5 })
      : null;
  const noteField = field({
    label: program.id === 'birthday' ? '希望收到什么样的祝福' : '可联系时段与兴趣标签',
    name: 'note',
    multiline: true,
    rows: 3,
    maxlength: 300,
    placeholder: program.id === 'birthday' ? '例如：文字就好，不需要电话或当面祝福' : '例如：晚上 9 点后有空；喜欢跑步、摄影、自习搭子',
  });

  const frequencyControl = segmented({
    items: [
      { value: 'weekly', label: '按周期接收' },
      { value: 'once', label: '只参加一次' },
    ],
    value: frequency,
    ariaLabel: '接收频率',
    onChange: (value) => {
      frequency = value;
      frequencyControl.setValue(value);
    },
  });

  const consent = checkbox({
    name: 'consent',
    label: '我自愿加入，并了解可以随时退出',
    description: '所有内容都会先经人工审核再转达。你可以随时通过邮件或会员中心的编号查询页面要求退出、屏蔽或举报；退出后不会再进入任何匹配与发送队列。',
  });

  const submitButton = button({ label: '确认加入', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '温暖连接',
    title: `加入${program.name}`,
    description: '自愿加入 · 人工审核 · 随时退出',
    width: 500,
    body: [
      notice(`平台会记录：${program.collects.join('、')}。除此之外不收集其他个人信息。`, { tone: 'info', title: '这次会用到的信息' }),
      h('div', { class: 'formgrid' }, nicknameField, emailField),
      h('div', { class: 'formgrid' }, campusField, birthdayField),
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '接收频率' }), frequencyControl),
      noteField,
      consent,
    ].filter(Boolean),
    footer: [
      h('p', { class: 't-caption t-faint', text: '登记后仍需管理员人工确认' }),
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  async function submit() {
    nicknameField.setError(null);
    emailField.setError(null);
    let invalid = null;
    if (!nicknameField.control.value.trim()) {
      nicknameField.setError('请填写显示昵称');
      invalid = nicknameField;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.control.value.trim())) {
      emailField.setError('请填写有效的校内邮箱');
      invalid = invalid || emailField;
    }
    if (birthdayField && birthdayField.control.value.trim() && !/^\d{2}-\d{2}$/.test(birthdayField.control.value.trim())) {
      birthdayField.setError('请使用「月-日」格式，例如 03-18');
      invalid = invalid || birthdayField;
    }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
      return;
    }
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要你的明确同意', '这个项目必须自愿加入，请先勾选同意说明。');
      return;
    }

    try {
      const payload = await runWithLoading(submitButton, () =>
        publicApi.warmthInterest({
          program: program.id,
          frequency,
          nickname: nicknameField.control.value.trim(),
          email: emailField.control.value.trim(),
          campus: campusField.control.value.trim(),
          birthdayMonthDay: birthdayField ? birthdayField.control.value.trim() : '',
          note: noteField.control.value.trim(),
          consent: true,
        }),
      );
      drawer.setBody(
        receipt({
          title: '已记录你的参加意愿',
          rows: [
            ['登记编号', payload.interest.id],
            ['项目', program.name],
            ['接收频率', frequency === 'weekly' ? '按周期接收' : '只参加一次'],
            ['当前状态', payload.interest.status],
          ],
        }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.interest.id, { label: '复制登记编号' })),
        notice('想退出时，把登记编号发给管理员，或直接回复任意一封项目邮件，都会立即停止发送。', { tone: 'neutral' }),
      );
      drawer.setFooter(h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }));
      notify.success('登记成功', payload.message, { duration: 7000 });
      onDone?.();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && (error.isConflict || error.status === 400 || error.isRateLimited)) {
        notify.warning('未能完成登记', error.message);
        return;
      }
      reportError(error, '未能完成登记');
    }
  }
}

export default async function warmthPage() {
  const cards = h(
    'div',
    { class: 'programs community-programs' },
    ...PROGRAMS.map((program) =>
      h(
        'div',
        { class: 'program' },
        h('span', { class: 'program__icon' }, icon(program.iconName, 'ico ico--lg')),
        h(
          'div',
          { class: 'program__body' },
          h('div', { class: 'row-3 row-wrap' }, h('h3', { class: 't-h3', text: program.name }), badge('自愿加入', { tone: 'success', iconName: 'check' })),
          h('p', { class: 't-secondary', text: program.summary }),
          h(
            'div',
            { class: 'warmth__facts' },
            h(
              'div',
              { class: 'stack-2' },
              h('p', { class: 't-label', text: '会用到的信息' }),
              h('ul', { class: 'bullets' }, ...program.collects.map((item) => h('li', null, icon('check', 'ico ico--sm'), h('span', { text: item })))),
            ),
          ),
        ),
        button({
          label: `加入${program.name}`,
          variant: 'primary',
          iconAfter: 'arrowRight',
          iconMotion: 'nudge',
          onClick: () => {
            // The opt-in is recorded against an account so the participant can
            // withdraw on their own later, without emailing anyone.
            if (!isSignedIn()) {
              notify.info('加入前请先登录', '登录后这条登记会归属到你的账号，随时可以查看和退出。');
              navigate(loginHref());
              return;
            }
            openJoinDrawer(program, {});
          },
        }),
      ),
    ),
  );
  stagger(cards);

  const node = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'formpage community-page' },
      h(
        'header',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('p', { class: 't-label', text: '内建广场' }),
        h('h1', { class: 't-h1', text: '把温暖留给身边的同伴' }),
        h('p', {
          class: 't-prose',
          text: '生日时收到一句祝福，忙碌的一周里互道早安。选择你喜欢的方式，加入红会同伴的日常。',
        }),
      ),
      cards,
      h(
        'section',
        { class: 'stack-4' },
        h('div', { class: 'section-head' }, h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '怎样开始参与' }), h('p', { class: 't-caption', text: '选择计划，完成登记，在会员中心查看你的参与记录。' }))),
        timeline([
          { title: '选择喜欢的计划', description: '生日祝福或早安晚安，按自己的节奏参与。', state: 'done', iconName: 'heart' },
          { title: '填写参与信息', description: '留下昵称、联系邮箱与希望接收的频率。', state: 'active', iconName: 'user' },
          { title: '期待同伴的问候', description: '在邮件里接收祝福，随时在会员中心调整参与状态。', iconName: 'mail' },
        ]),
      ),
      notice('如果你在参与过程中感到不适，或收到任何不恰当的内容，请立刻联系管理员举报。举报会暂停相关发送并进入人工处置流程。', { tone: 'warning', title: '遇到问题怎么办' }),
    ),
  );

  return { title: '内建广场', node };
}
