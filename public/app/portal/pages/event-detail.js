/* ==========================================================================
   portal/pages/event-detail.js
   Task: understand one activity and complete registration without leaving the
   page. Registration runs in a drawer with an explicit impact preview and a
   downloadable credential as the result state.
   ========================================================================== */

import { h, icon, clear, fill } from '../../core/dom.js';
import { publicApi, ApiError, getAccountProfile } from '../../core/api.js';
import { expandFromOrigin, shake, stagger } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { openDrawer } from '../../ui/overlay.js';
import {
  button, badge, statusIndicator, field, checkbox, notice, receipt, barTrack,
  emptyState, errorState, skeletonBlock, steps, copyableCode, runWithLoading, guidanceCards, activityFacts,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { sessionChoices } from '../session-choices.js';
import { eventCard } from './home.js';
import { isSignedIn, loginHref, redirectIfAuthError } from '../auth-gate.js';



async function openRegistrationDrawer(event, { onDone, sessionId }) {
  let account;try{({account}=await getAccountProfile());}catch(error){reportError(error,'个人资料读取失败');return;}
  if(!account.realName||!account.emailVerified){notify.error('请先在会员中心完善姓名和邮箱验证');navigate('/me');return;}
  let selectedSession = event.sessions.find(session=>session.sessionId===sessionId) || event.sessions.find((session) => !session.full) || event.sessions[0] || null;
  const stepSlot = h('div', null, steps(['填写信息', '确认授权', '完成'], 0));

  const nameField = field({ label: '姓名', name: 'name', required: true, value:account.realName,readonly:true,iconName: 'user' });
  const emailField = field({
    label: '校内邮箱',
    name: 'email',
    type: 'email',
    required: true,
    value:account.email,readonly:true,
    hint: '报名结果将发送至此邮箱。',
    iconName: 'mail',
  });
  const campusField = field({ label: '校区', name: 'campus', placeholder: '鼓楼 / 仙林 / 苏州', value: account.campus || event.campus || '' });
  const noteField = field({ label: '需要我们知道的情况', name: 'note', multiline: true, rows: 3, placeholder: '例如：有急救证、需要无障碍协助、只能参加部分时段', maxlength: 300 });

  const sessionSlot = h('div', { class: 'stack-3' });
  const impactSlot = h('div', null);

  function renderImpact() {
    const scope = selectedSession || event;
    const full = selectedSession ? selectedSession.full : event.full;
    submitButton.querySelector('span').textContent=full?'提交并加入候补':'提交报名';
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
    sessionSlot.append(sessionChoices(event,selectedSession?.sessionId,session=>{selectedSession=session;renderImpact();},'drawer-session'));
  }

  const consent = checkbox({
    name: 'consent',
    label: '我确认自愿报名，并同意平台为本次活动使用上述信息',
    description: '信息仅用于本次活动的名额确认、现场签到与必要通知；不会在公开页面展示，也不会用于其他用途。你可以随时通过会员中心的编号查询查询或联系管理员取消。',
  });

  const submitButton = button({
    label: (selectedSession ? selectedSession.full : event.full) ? '提交并加入候补' : '提交报名',
    variant: 'primary',
    iconName: 'check',
    onClick: () => submit(),
  });

  const drawer = openDrawer({
    eyebrow: event.type || '活动报名',
    title: event.name,
    description: fmt.dateRange(event.startAt, event.endAt),
    width: 520,
    body: [
      stepSlot,
      sessionSlot,
      h('div', { class: 'formgrid' }, nameField, emailField),
      campusField,
      noteField,
      consent,
      impactSlot,
    ],
    footer: [
      h('p', { class: 't-caption t-faint', text: '提交前请再次确认邮箱是否正确' }),
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  renderSessions();
  renderImpact();

  let submitting=false;
  async function submit() {
    if(submitting)return;
    for (const control of [nameField, emailField]) control.setError(null);
    const name = nameField.control.value.trim();
    const email = emailField.control.value.trim();
    let invalid = null;
    if (!name) {
      nameField.setError('请填写姓名');
      invalid = nameField;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailField.setError('请填写有效的校内邮箱');
      invalid = invalid || emailField;
    }
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要你的明确同意', '请勾选授权说明后再提交报名。');
      return;
    }
    if (invalid) {
      shake(invalid);
      invalid.control.focus();
      return;
    }

    stepSlot.replaceChildren(steps(['填写信息', '确认授权', '完成'], 1));

    submitting=true;
    try {
      const payload = await runWithLoading(submitButton, () =>
        publicApi.register(event.eventId, {
          name,
          email,
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
      drawer.body.scrollTop=0;
      drawer.body.tabIndex=-1;drawer.body.focus({preventScroll:true});
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
      if (error instanceof ApiError && error.isConflict) {
        emailField.setError(error.message);
        shake(emailField);
        notify.warning('无法提交报名', error.message);
        return;
      }
      if (error instanceof ApiError && error.status === 400) {
        emailField.setError(error.message);
        shake(emailField);
        return;
      }
      reportError(error, '报名未提交');
    } finally { submitting=false; }
  }
}

export default async function eventDetailPage(context) {
  const mainSlot = h('div', { class: 'pdetail__main' }, skeletonBlock('220px'), skeletonBlock('160px'));
  const asideSlot = h('aside', { class: 'pdetail__aside' }, skeletonBlock('220px'));

  const node = h(
    'div',
    { class: 'view ordinary-event-detail' },
    h(
      'div',
      { class: 'pdetail' },
      mainSlot,
      asideSlot,
    ),
  );

  const origin = context.state?.origin || null;
  requestAnimationFrame(() => expandFromOrigin(node.firstElementChild, origin));

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
    let selectedSession=event.sessions.find(session=>!session.full)||event.sessions[0]||null;
    const bookingScope=()=>selectedSession||event;
    const bookingCount=h('b',{class:'booking-number'});
    const bookingOutcome=h('p',{class:'booking-outcome'});
    function updateBooking(){
      const scope=bookingScope();
      bookingCount.textContent=scope.remaining==null?'—':String(scope.remaining);
      bookingOutcome.textContent=!registrationOpen?'报名已关闭':scope.full?'名额已满，提交后进入候补队列。':'提交后直接确认，生成签到凭证。';
      registerButton.querySelector('span').textContent=!registrationOpen?'报名已关闭':scope.full?'加入候补队列':'立即报名';
    }
    const registerButton = button({
      label: registrationOpen ? (event.full ? '加入候补队列' : '立即报名') : '报名已关闭',
      variant: registrationOpen ? 'primary' : 'secondary',
      size: 'lg',
      block: true,
      iconName: registrationOpen ? 'check' : 'lock',
      disabled: !registrationOpen,
      onClick: () => {
        // Registration writes a record owned by an account, so ask for the
        // account before opening a form rather than after submitting it.
        if (!isSignedIn()) {
          notify.info('报名需要先登录', '登录后这条报名会归属到你的账号，可在会员中心查看。');
          navigate(loginHref());
          return;
        }
        openRegistrationDrawer(event, { sessionId:selectedSession?.sessionId,onDone: () => navigate(`/events/${encodeURIComponent(event.eventId)}`, { replace: true }) });
      },
    });

    clear(mainSlot);
    fill(mainSlot,
      h(
        'div',
        { class: 'pdetail__hero' },
        h(
          'div',
          { class: 'row-3 row-wrap' },
          h('a', { class: 't-caption t-muted row-2', href: '/events' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回活动广场' })),
        ),
        h(
          'div',
          { class: 'row-3 row-wrap' },
          badge(event.type || '公益活动', { tone: 'accent' }),
          registrationOpen
            ? statusIndicator(event.full ? '名额已满 · 开放候补' : `剩余 ${event.remaining} 个名额`, { tone: event.full ? 'warning' : 'success', live: true })
            : statusIndicator(event.status, { tone: event.status === '进行中' ? 'info' : 'idle' }),
        ),
        h('h1', { class: 't-display', text: event.name }),

      ),
      event.description?h('section',{class:'event-editorial-copy'},h('h2',{class:'t-h2',text:'活动介绍'}),h('p',{class:'t-prose',text:event.description})):null,
      activityFacts([
        {label:'活动时间',value:fmt.dateRange(event.startAt,event.endAt),iconName:'calendar'},
        {label:'地点',value:[event.campus,event.location].filter(Boolean).join(' · ')||'待公布',iconName:'pin'},
        {label:'报名截止',value:fmt.fullDateTime(event.registrationEnd),iconName:'clock'},
        {label:'报名名额',value:event.capacity?`${event.remaining} 个剩余 / 共 ${event.capacity} 人`:'不限',iconName:'users'},
      ]),
      event.sessions.length
        ? h(
            'section',
            { class: 'stack-4' },
            h('div', { class: 'section-head' }, h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '场次安排' }), h('p', { class: 't-caption', text: '报名时可以选择具体场次，名额分别计算。' }))),
            sessionChoices(event,selectedSession?.sessionId,session=>{selectedSession=session;updateBooking();}),
          )
        : null,
      guidanceCards([
        { iconName: 'qr', title: '现场签到', text: '携带校园卡或学生证，出示报名二维码或编号完成签到。' },
        { iconName: 'users', title: '候补通知', text: '名额已满时可加入候补；递补成功后会通过邮箱通知。' },
        { iconName: 'mail', title: '报名联系', text: '报名邮箱用于接收活动确认和必要通知，请留意收件箱。' },
      ], { title: '参加须知' }),
      payload.related?.length
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
        : null,
    );

    asideSlot.replaceChildren(
      h(
        'section',
        { class: 'panel panel--raised event-booking-panel' },
        h(
          'div',
          { class: 'panel__body stack-4' },
          h(
            'div',
            { class: 'stack-2' },
            h('p', { class: 't-label', text: event.sessions.length?'所选场次剩余名额':'剩余报名名额' }),
            h('div',{class:'booking-count'},bookingCount,h('span',{text:'个名额'})),bookingOutcome,
            h('p',{class:'t-caption',text:`报名截止：${fmt.fullDateTime(event.registrationEnd)||'以活动通知为准'}`}),
            h('p',{class:'t-caption',text:`全活动已确认 ${event.confirmed}${event.capacity?` / ${event.capacity}`:''} 人`}),
            event.capacity
              ? barTrack([
                  { label: '已确认', value: event.confirmed, color: event.full ? 'var(--warning)' : 'var(--accent)' },
                  { label: '剩余', value: Math.max(0, event.capacity - event.confirmed), color: 'transparent' },
                ])
              : null,
            event.waitlisted ? h('p', { class: 't-caption', text: `当前候补 ${event.waitlisted} 人` }) : null,
          ),
          h('hr', { class: 'divider' }),
          registerButton,
          h('p', { class: 't-caption', text: registrationOpen ? '提交结果以服务器返回为准；候补与确认状态将在凭证中明确显示。' : '该活动已不再接受新的报名。' }),
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel__body stack-3' },
          h('p', { class: 't-label', text: '已经报名？' }),
          h('p', { class: 't-caption', text: '用报名编号和邮箱即可查询确认状态、候补顺序与签到记录。' }),
          button({ label: '查询我的状态', variant: 'secondary', block: true, iconName: 'target', href: '/status' }),
        ),
      ),
    );
    updateBooking();
    const heading=mainSlot.querySelector('.pdetail__hero');heading.classList.add('event-editorial-heading');node.prepend(heading);
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
    asideSlot.replaceChildren();
  }

  return { title, node };
}
