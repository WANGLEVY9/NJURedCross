import {eventSignupState} from '../event-signup.js';
/* ==========================================================================
   portal/pages/event-detail.js
   Task: understand one activity and complete registration without leaving the
   page. The panel shows the key facts; the sign-up runs in a drawer with an
   explicit three-step flow, an impact preview and a downloadable credential.
   Identity (name, campus email) comes from the verified account and stays
   read-only; only session, campus and note remain editable per registration.
   ========================================================================== */

import { h, icon, clear, fill } from '../../core/dom.js';
import { publicApi, portal, request, ApiError, getAccountProfile } from '../../core/api.js';
import { expandFromOrigin, shake, stagger } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import {
  button, badge, statusIndicator, field, checkbox, notice, receipt, steps,
  emptyState, errorState, skeletonBlock, copyableCode, runWithLoading, guidanceCards,
  pageHead, panel, definitionList,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { eventCard } from './home.js';
import { isSignedIn, loginHref, redirectIfAuthError } from '../auth-gate.js';

function sessionList(event) {
  if (!event.sessions.length) return null;
  return h(
    'div',
    { class: 'stack-3' },
    h('p', { class: 'field__label', text: '场次安排' }),
    h(
      'div',
      { class: 'sessions' },
      ...event.sessions.map((session) =>
        h(
          'div',
          { class: 'session' },
          h('span', { class: 'session__radio' }),
          h(
            'span',
            { class: 'stack-1' },
            h('b', { class: 't-secondary t-strong', text: fmt.dateRange(session.startAt, session.endAt) }),
            h('span', { class: 't-caption', text: [session.location || event.location, session.checkinMethod].filter(Boolean).join(' · ') || '地点待公布' }),
          ),
          session.full ? badge('已满 · 可候补', { tone: 'warning' }) : badge(`剩 ${session.remaining}`, { tone: 'success' }),
        ),
      ),
    ),
  );
}

async function openRegistrationDrawer(event, { onDone }) {
  let account;
  try { ({ account } = await getAccountProfile()); } catch (error) { reportError(error, '个人资料读取失败'); return; }
  if (!account.realName || !account.emailVerified) {
    notify.error('请先在会员中心完善姓名和邮箱验证');
    navigate('/me');
    return;
  }

  let selectedSession = event.sessions.find((session) => !session.full) || event.sessions[0] || null;
  const stepSlot = h('div', null, steps(['填写信息', '确认授权', '完成'], 0));

  // Identity from the verified account — read-only, not editable in the drawer.
  const identitySection = h(
    'section',
    { class: 'identity-section' },
    h('p', { class: 'identity-section__title', text: '报名身份 · 已验证，不可在此修改' }),
    definitionList([
      ['姓名', account.realName],
      ['校内邮箱', account.email],
    ]),
  );
  const campusField = field({
    label: '校区',
    name: 'campus',
    value: account.campus || '',
    options: [
      { value: '', label: '请选择校区' },
      ...['鼓楼', '仙林', '浦口', '苏州', '其他'].map((value) => ({ value, label: value })),
    ],
    hint: '已按账号资料填入，可按本次活动需要调整。',
  });
  const noteField = field({ label: '需要我们知道的情况', name: 'note', multiline: true, rows: 3, placeholder: '例如：有急救证、需要无障碍协助、只能参加部分时段', maxlength: 300 });

  const sessionSlot = h('div', { class: 'stack-3' });
  const impactSlot = h('div', null);

  function renderImpact() {
    const scope = selectedSession || event;
    const full = selectedSession ? selectedSession.full : event.full;
    clear(impactSlot);
    impactSlot.append(
      full
        ? notice(
            `该${selectedSession ? '场次' : '活动'}名额已满。提交后你会进入候补队列，前面的人取消时会按顺序自动递补，并通过邮箱通知你。`,
            { tone: 'warning', title: '提交结果：进入候补' },
          )
        : notice(
            `提交后名额将立即确认，剩余名额 ${scope.remaining} → ${Math.max(0, scope.remaining - 1)}，并生成仅你可见的签到凭证。`,
            { tone: 'info', title: '提交结果：直接确认' },
          ),
    );
  }

  function renderSessions() {
    clear(sessionSlot);
    if (event.sessions.length <= 1) {
      sessionSlot.append(
        h('p', { class: 't-caption', text: event.sessions.length === 1 ? `场次：${fmt.dateRange(event.sessions[0].startAt, event.sessions[0].endAt)}` : '该活动暂未拆分场次，报名后按活动整体时间安排参加。' }),
      );
      return;
    }
    sessionSlot.append(h('p', { class: 'field__label', text: '选择场次' }));
    const group = h('div', { class: 'sessions', attrs: { role: 'radiogroup', 'aria-label': '选择场次' } });
    for (const session of event.sessions) {
      const row = h(
        'button',
        {
          class: 'session',
          type: 'button',
          attrs: { role: 'radio' },
          aria: { checked: String(selectedSession?.sessionId === session.sessionId) },
          on: {
            click: () => {
              selectedSession = session;
              renderSessions();
              renderImpact();
            },
          },
        },
        h('span', { class: 'session__radio' }),
        h(
          'span',
          { class: 'stack-1' },
          h('b', { class: 't-secondary t-strong', text: fmt.dateRange(session.startAt, session.endAt) }),
          h('span', { class: 't-caption', text: session.location || event.location || '地点待公布' }),
        ),
        session.full
          ? badge('候补', { tone: 'warning' })
          : h('span', { class: 't-caption t-muted', text: `剩 ${session.remaining}` }),
      );
      group.append(row);
    }
    sessionSlot.append(group);
  }

  const consent = checkbox({
    name: 'consent',
    label: '我确认自愿报名，并同意平台为本次活动使用上述信息',
    description: '信息仅用于本次活动的名额确认、现场签到与必要通知；不会在公开页面展示，也不会用于其他用途。你可以随时通过会员中心的编号查询查询或联系管理员取消。',
  });

  const submitButton = button({
    label: selectedSession?.full || event.full ? '提交并加入候补' : '提交报名',
    variant: 'primary',
    iconName: 'check',
    onClick: () => submit(),
  });

  const drawer = openDrawer({
    eyebrow: event.type || '活动报名',
    title: event.name,
    description: fmt.dateRange(event.startAt, event.endAt),
    width: 600,
    body: [
      stepSlot,
      sessionSlot,
      identitySection,
      campusField,
      noteField,
      consent,
      impactSlot,
    ],
    footer: [
      h('p', { class: 't-caption t-faint', text: '提交后报名结果将发送至校内邮箱' }),
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  drawer.surface.classList.add('event-registration');

  renderSessions();
  renderImpact();

  async function submit() {
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要你的明确同意', '请勾选授权说明后再提交报名。');
      return;
    }

    stepSlot.replaceChildren(steps(['填写信息', '确认授权', '完成'], 1));

    try {
      const payload = await runWithLoading(submitButton, () =>
        publicApi.register(event.eventId, {
          name: account.realName,
          email: account.email,
          campus: campusField.control.value.trim(),
          note: noteField.control.value.trim(),
          sessionId: selectedSession?.sessionId || '',
          consent: true,
        }),
      );

      const registration = payload.registration;
      stepSlot.replaceChildren(steps(['填写信息', '确认授权', '完成'], 2));

      const qr = h('img', {
        class: 'qr',
        src: registration.qrDataUrl,
        alt: '报名签到二维码',
        attrs: { width: 168, height: 168 },
      });

      drawer.setBody(
        stepSlot,
        receipt({
          title: registration.status === '已确认' ? '报名已确认' : `已进入候补（第 ${registration.waitlist} 位）`,
          rows: [
            ['报名编号', registration.code],
            ['活动', registration.eventName],
            ['开始时间', fmt.fullDateTime(registration.sessionStartAt)],
            ['地点', registration.location || '待公布'],
            ['当前状态', registration.status],
          ],
        }),
        h(
          'div',
          { class: 'qr-block' },
          qr,
          h(
            'div',
            { class: 'stack-3' },
            h('p', { class: 't-secondary t-strong', text: '现场签到凭证' }),
            h('p', { class: 't-caption', text: '请保存这张二维码或记下报名编号。签到码只在本次响应中出现，平台只保存它的摘要，无法二次展示。' }),
            copyableCode(registration.code, { label: '复制报名编号' }),
            button({
              label: '下载凭证图片',
              variant: 'secondary',
              size: 'sm',
              iconName: 'download',
              onClick: () => {
                const link = document.createElement('a');
                link.href = registration.qrDataUrl;
                link.download = `${registration.code}.png`;
                link.click();
              },
            }),
          ),
        ),
        notice('如果无法参加，请尽早在会员中心的编号查询中联系管理员取消，让候补同学能够顺利递补。', { tone: 'info' }),
      );
      drawer.setFooter(
        button({ label: '查询我的状态', variant: 'ghost', iconName: 'target', href: '/status' }),
        h('span', { class: 'spacer' }),
        button({ label: '完成', variant: 'primary', onClick: () => drawer.close() }),
      );

      notify.success(payload.message || '报名已提交', `报名编号 ${registration.code}`, { duration: 7000 });
      onDone?.();
    } catch (error) {
      stepSlot.replaceChildren(steps(['填写信息', '确认授权', '完成'], 0));
      if (redirectIfAuthError(error)) return;
      notify.warning('无法提交报名', error instanceof ApiError ? error.message : '请稍后重试');
      reportError(error, '报名未提交');
    }
  }
}

/** One of the user's registration records, mirroring the workflow records style. */
function myRegistrationRecord(reg, { onCancel }) {
  const tone = ['已确认', '已签到'].includes(reg.status) ? 'success' : reg.status === '已取消' ? 'error' : 'warning';
  let cancelButton;
  if (['已确认', '候补'].includes(reg.status)) {
    cancelButton = button({
      label: '取消报名',
      variant: 'danger',
      iconName: 'close',
      onClick: async () => {
        const yes = await confirmAction({
          title: '确认取消这条报名吗？',
          description: `取消「${reg.eventName}」的报名后不能恢复；如需继续参加请重新报名，候补同学会按顺序递补。`,
          confirmLabel: '确认取消报名',
          tone: 'danger',
        });
        if (!yes) return;
        try {
          await runWithLoading(cancelButton, () =>
            request(`/api/portal/events/registrations/${encodeURIComponent(reg.code)}/cancel`, { method: 'POST', body: {} }));
          notify.success('报名已取消');
          onCancel?.();
        } catch (error) {
          reportError(error, '取消未完成');
        }
      },
    });
  }
  return h(
    'section',
    { class: 'stack-3 workflow-registration' },
    h('h3', { class: 't-h3', text: reg.eventName }),
    h('p', { text: [reg.startAt ? fmt.fullDateTime(reg.startAt) : '时间待定', reg.location || '地点待公布'].filter(Boolean).join(' · ') }),
    h(
      'div',
      { class: 'row-3 row-wrap' },
      badge(reg.status, { tone }),
      reg.status === '候补' && reg.waitlist ? badge(`候补第 ${reg.waitlist} 位`, { tone: 'warning' }) : null,
    ),
    h('p', {
      class: 't-caption',
      text: [
        `报名编号：${reg.code}`,
        reg.checkedInAt ? `签到时间：${fmt.fullDateTime(reg.checkedInAt)}` : null,
        reg.cancelledAt ? `取消时间：${fmt.fullDateTime(reg.cancelledAt)}` : null,
      ].filter(Boolean).join(' · '),
    }),
    cancelButton,
  );
}

export default async function eventDetailPage(context) {
  const mainSlot = h('div', { class: 'stack-5' }, skeletonBlock('220px'), skeletonBlock('220px'), skeletonBlock('160px'));

  const node = h(
    'div',
    { class: 'view formpage stack-6 workflow-page' },
    h('a', { class: 'workflow-back', href: '/events' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '活动广场' })),
    mainSlot,
  );

  const origin = context.state?.origin || null;
  requestAnimationFrame(() => expandFromOrigin(mainSlot, origin));

  let title = '活动详情';

  try {
    const payload = await publicApi.event(context.params.eventId);
    const event = payload.event;
    if (event.workflowId) {
      const { default: workflowEventsPage } = await import('./workflow-events.js');
      return workflowEventsPage({ ...context, query: new URLSearchParams({ event: event.workflowId }) });
    }
    title = event.name;

    const registrationOpen = event.status === '报名中';
    let records = [], loadFailed = false;
    if (isSignedIn()) {
      try { records = (await portal.me()).registrations || []; }
      catch { loadFailed = true; }
    }
    const signup = eventSignupState(event, records);
    if (loadFailed && !signup.disabled) Object.assign(signup, {label:'报名状态暂不可用',disabled:true});


    const head = pageHead({
      title: '活动详情与报名',
      description: '点击报名后按三步流程完成提交，报名信息将自动填入你的账号资料。',
      meta: [
        badge(event.type || '公益活动', { tone: 'accent' }),
        registrationOpen
          ? statusIndicator(event.full ? '已报满' : `剩余 ${event.remaining} 个名额`, { tone: event.full ? 'warning' : 'success', live: true })
          : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
      ],
    });

    const infoPanel = panel({
      title: event.name,
      body: h(
        'div',
        { class: 'stack-4' },
        definitionList([
          ['活动时间', fmt.dateRange(event.startAt, event.endAt)],
          ['地点', [event.campus, event.location].filter(Boolean).join(' · ') || '待公布'],
          ['报名截止', fmt.fullDateTime(event.registrationEnd)],
          ['容量', event.capacity ? `${event.confirmed} / ${event.capacity} 人已确认` : '不限'],
          event.waitlisted ? ['当前候补', `${event.waitlisted} 人`] : null,
        ]),
        event.description ? h('p', { class: 't-secondary', text: event.description }) : null,
        sessionList(event),
        h('hr', { class: 'divider' }),
        registrationOpen
          ? h('div', { class: 'stack-3' },
              button({
                label: signup.label,
                disabled: signup.disabled,
                variant: 'primary',
                size: 'lg',
                block: true,
                iconName: 'check',
                onClick: () => {
                  // Registration writes a record owned by an account, so ask for the
                  // account before opening a form rather than after submitting it.
                  if (!isSignedIn()) {
                    notify.info('报名需要先登录', '登录后这条报名会归属到你的账号，可在会员中心查看。');
                    navigate(loginHref());
                    return;
                  }
                  openRegistrationDrawer(event, { onDone: () => navigate(`/events/${encodeURIComponent(event.eventId)}`, { replace: true }) });
                },
              }),
              h('p', { class: 't-caption', text: '报名身份来自已验证的账号资料，校区与备注可按本次活动需要修改；提交需要勾选确认授权。' }))
          : h('div', { class: 'stack-4' },
              notice('该活动已不再接受新的报名。', { tone: 'neutral' }),
              button({ label: '查询我的状态', variant: 'secondary', iconName: 'target', href: '/status' })),
        guidanceCards([
          { iconName: 'qr', title: '现场签到', text: '携带校园卡或学生证，出示报名二维码或编号完成签到。' },
          { iconName: 'users', title: '报名名额', text: '名额已满时暂停报名，请留意后续名额变化。' },
          { iconName: 'mail', title: '报名联系', text: '报名邮箱用于接收活动确认和必要通知，请留意收件箱。' },
        ], { title: '参加须知' }),
      ),
    });

    // 我的报名与签到：登录后始终展示，仅显示本活动的报名与签到记录（含已取消）。
    let myRegistrationSection = null;
    if (isSignedIn()) {
      const ownRecords = records
        .filter((r) => r.eventId === event.eventId)
        .sort((a, b) => {
          // 最新确认报名一定在最上面：已取消的排后面，同组内按 submittedAt 倒序
          // （缺失时回退到 startAt），保证最新一条有效报名永远在顶部。
          const aInactive = a.status === '已取消' ? 1 : 0;
          const bInactive = b.status === '已取消' ? 1 : 0;
          if (aInactive !== bInactive) return aInactive - bInactive;
          const aTime = a.submittedAt || a.startAt || '';
          const bTime = b.submittedAt || b.startAt || '';
          return bTime.localeCompare(aTime);
        });
      const refresh = () => navigate(`/events/${encodeURIComponent(event.eventId)}`, { replace: true });
      myRegistrationSection = h(
        'section',
        { id: 'event-records', class: 'workflow-records' },
        panel({
          title: '我的报名与签到',
          body: h(
            'div',
            { class: 'stack-5' },
            ...ownRecords.map((reg) => myRegistrationRecord(reg, { onCancel: refresh })),
            loadFailed ? notice('报名记录暂时无法加载，请稍后刷新重试。', { tone: 'warning' }) : null,
            !loadFailed && !ownRecords.length
              ? emptyState({
                  iconName: 'inbox',
                  title: '尚未报名',
                  description: '在活动广场选择活动完成报名后，进度与签到状态会显示在这里。',
                })
              : null,
          ),
        }),
      );
    }

    const related = payload.related?.length
      ? h(
          'section',
          { class: 'stack-4' },
          h('div', { class: 'section-head' }, h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '你可能也想参加' }))),
          (() => {
            const rail = h('div', { class: 'rail' }, ...payload.related.map((item) => eventCard(item, { compact: true })));
            stagger(rail);
            return rail;
          })(),
        )
      : null;

    fill(mainSlot, head, infoPanel, myRegistrationSection, related);
  } catch (error) {
    clear(mainSlot);
    fill(mainSlot,
      error?.status === 404
        ? emptyState({
            iconName: 'calendar',
            title: '这个活动不存在或尚未公开',
            description: '链接可能已经过期，或者活动还在草稿状态。可以回到活动广场查看正在开放的活动。',
            actions: [button({ label: '返回活动广场', variant: 'primary', iconName: 'chevronLeft', href: '/events' })],
          })
        : errorState({ title: '活动详情无法加载', error, onRetry: () => navigate(context.path, { replace: true }), onBack: () => navigate('/events') }),
    );
  }

  return { title, node };
}
