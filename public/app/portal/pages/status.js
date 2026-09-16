/* ==========================================================================
   portal/pages/status.js
   Task: "where is my registration?" — one lookup, one clear answer, plus the
   next action. Lookup requires both the code and the email that owns it.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { button, field, notice, statusIndicator, timeline, emptyState, definitionList, runWithLoading, badge } from '../../ui/primitives.js';
import { reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';

function statusTimeline(registration) {
  const cancelled = Boolean(registration.cancelledAt);
  const checkedIn = Boolean(registration.checkedInAt);
  const confirmed = registration.status === '已确认' || checkedIn;
  return timeline([
    {
      title: '报名已提交',
      description: `提交时间 ${fmt.fullDateTime(registration.submittedAt)}`,
      state: 'done',
      iconName: 'check',
    },
    {
      title: cancelled ? '报名已取消' : confirmed ? '名额已确认' : `候补第 ${registration.waitlist || '—'} 位`,
      description: cancelled
        ? `取消时间 ${fmt.fullDateTime(registration.cancelledAt)}`
        : confirmed
          ? '你可以按活动时间到场，现场出示报名二维码或报名编号完成签到。'
          : '前面的同学取消时会按顺序递补，递补结果会发送到你的报名邮箱。',
      state: cancelled ? 'blocked' : confirmed ? 'done' : 'active',
      iconName: cancelled ? 'close' : confirmed ? 'check' : 'clock',
    },
    {
      title: checkedIn ? '现场签到完成' : '现场签到',
      description: checkedIn ? `签到时间 ${fmt.fullDateTime(registration.checkedInAt)}` : '活动当天由工作人员扫描你的报名二维码完成核验。',
      state: checkedIn ? 'done' : cancelled ? 'blocked' : 'pending',
      iconName: 'qr',
    },
  ]);
}

export default async function statusPage(context) {
  const codeField = field({
    label: '报名编号',
    name: 'code',
    required: true,
    placeholder: 'REG-XXXXXXXX-XXXXXX',
    value: context.query.get('code') || '',
    iconName: 'target',
    hint: '报名成功时显示的编号，也在确认邮件里。',
  });
  const emailField = field({
    label: '报名邮箱',
    name: 'email',
    type: 'email',
    required: false,
    placeholder: 'your_id@smail.nju.edu.cn',
    iconName: 'mail',
    hint: '本账号提交的报名只需编号；查询他人代提交的记录时才需要填写当时的邮箱。',
  });

  const resultSlot = h('div', { class: 'stack-5' });

  const lookupButton = button({ label: '查询状态', variant: 'primary', iconName: 'search', onClick: () => lookup() });

  function showIdle() {
    clear(resultSlot);
    resultSlot.append(
      emptyState({
        iconName: 'search',
        title: '输入报名编号与邮箱开始查询',
        description: '为保护个人信息，查询需要同时提供报名编号和报名时使用的邮箱。两者匹配时才会返回这条记录的状态。',
      }),
    );
  }

  async function lookup() {
    codeField.setError(null);
    emailField.setError(null);
    const code = codeField.control.value.trim();
    const email = emailField.control.value.trim();
    let invalid = null;
    if (!code) {
      codeField.setError('请填写报名编号');
      invalid = codeField;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailField.setError('请填写有效的邮箱地址');
      invalid = invalid || emailField;
    }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
      return;
    }

    clear(resultSlot);
    resultSlot.append(h('div', { class: 'sk sk--block' }));

    try {
      const payload = await runWithLoading(lookupButton, () => publicApi.lookup({ code, email }));
      const registration = payload.registration;
      const cancelled = Boolean(registration.cancelledAt);
      clear(resultSlot);
      resultSlot.append(
        h(
          'section',
          { class: 'panel panel--raised' },
          h(
            'header',
            { class: 'panel__head' },
            h(
              'div',
              { class: 'section-head__text' },
              h('p', { class: 't-label', text: '查询结果' }),
              h('h2', { class: 't-h2', text: registration.eventName }),
            ),
            h('span', { class: 'spacer' }),
            cancelled
              ? statusIndicator('已取消', { tone: 'error' })
              : statusIndicator(registration.status || '未知', { tone: registration.status === '已签到' || registration.status === '已确认' ? 'success' : 'warning', live: registration.status === '候补' }),
          ),
          h(
            'div',
            { class: 'panel__body stack-5' },
            definitionList([
              ['报名编号', h('code', { class: 't-data', text: registration.code })],
              ['活动状态', registration.eventStatus || '—'],
              ['活动时间', fmt.fullDateTime(registration.startAt)],
              ['地点', registration.location || '待公布'],
              registration.status === '候补' ? ['候补顺序', `第 ${registration.waitlist} 位`] : null,
            ]),
            h('hr', { class: 'divider' }),
            statusTimeline(registration),
          ),
          h(
            'footer',
            { class: 'panel__foot row-3' },
            h('span', { class: 't-caption', text: '需要取消报名或修改信息？请联系活动负责人，以便候补同学及时递补。' }),
            h('span', { class: 'spacer' }),
            button({ label: '浏览其他活动', variant: 'ghost', size: 'sm', iconAfter: 'arrowRight', iconMotion: 'nudge', href: '/events' }),
          ),
        ),
      );
    } catch (error) {
      clear(resultSlot);
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && error.status === 404) {
        resultSlot.append(
          emptyState({
            iconName: 'help',
            title: '没有找到匹配的记录',
            description: '请检查报名编号是否完整（区分前缀 REG-），以及邮箱是否与报名时一致。如果仍然查不到，可能这条报名并未成功提交。',
            actions: [button({ label: '重新报名', variant: 'primary', iconName: 'calendar', href: '/events' })],
          }),
        );
        return;
      }
      if (error instanceof ApiError && error.isRateLimited) {
        resultSlot.append(notice(error.message, { tone: 'warning', title: '查询过于频繁' }));
        return;
      }
      showIdle();
      reportError(error, '查询未完成');
    }
  }

  codeField.control.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') lookup();
  });
  emailField.control.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') lookup();
  });

  const signedIn = isSignedIn();
  const node = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'formpage' },
      h(
        'header',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '我的状态' }), badge(signedIn ? '按账号 + 编号查询' : '需要登录', { tone: 'accent', iconName: 'lock' })),
        h('h1', { class: 't-h1', text: '查询我的报名与候补进度' }),
        h('p', { class: 't-prose', text: '平台不会用姓名或学号做模糊查询，避免他人窥探你的参与记录。登录后，报名查询会自动限定在你自己的账号范围内。物资借用与投稿的结果会直接发送到你提交时填写的邮箱。' }),
      ),
      signedIn
        ? h(
            'section',
            { class: 'panel' },
            h('div', { class: 'panel__body stack-4' }, h('div', { class: 'formgrid' }, codeField, emailField), h('div', { class: 'row-3' }, h('span', { class: 'spacer' }), lookupButton)),
          )
        : loginRequiredPanel({ what: '查询我的记录', hint: '登录后可以直接在个人中心看到全部报名、投稿与温暖连接记录。' }),
      resultSlot,
    ),
  );

  if (signedIn) {
    showIdle();
    if (context.query.get('code')) requestAnimationFrame(() => emailField.control.focus());
  }
  return { title: '我的状态', node };
}
