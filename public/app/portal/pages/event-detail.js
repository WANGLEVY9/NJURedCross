import {activityWishlist} from '../activity-wishlist.js';
import {eventRegistrations} from '../event-registrations.js';
/* ==========================================================================
   portal/pages/event-detail.js
   Task: understand one activity and complete registration without leaving the
   page. Registration runs in a drawer with an explicit impact preview and a
   downloadable credential as the result state.
   ========================================================================== */

import { h, icon, clear, fill } from '../../core/dom.js';
import { publicApi, portal, ApiError, getAccountProfile } from '../../core/api.js';
import { expandFromOrigin, shake } from '../../core/motion.js';
import { eventCenterLabel } from '../event-center.js';
import { navigate } from '../../core/router.js';
import { openDrawer } from '../../ui/overlay.js';
import {
  button, badge, panel, field, checkbox, notice, receipt,
  emptyState, errorState, skeletonBlock, steps, copyableCode, runWithLoading, activityFacts,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { sessionChoices } from '../session-choices.js';
import { activityRegistrationDetail } from '../activity-registration-detail.js';
import { registrationsNewestFirst } from '../registration-order.js';
import { isSignedIn, loginHref, redirectIfAuthError } from '../auth-gate.js';



async function openRegistrationDrawer(event, { onDone, sessionId, consentConfirmed = false }) {
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
    submitButton.querySelector('span').textContent=full?'已报满':'提交报名';
    submitButton.disabled=full;
    clear(impactSlot);
    impactSlot.append(
      full
        ? notice(
            `该${selectedSession ? '场次' : '活动'}已报满，请选择其他场次或活动。`,
            { tone: 'warning', title: '已报满' },
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
    label: (selectedSession ? selectedSession.full : event.full) ? '已报满' : '提交报名',
    variant: 'primary',
    iconName: 'check',
    onClick: () => submit(),
  });

  const drawer = openDrawer({
    eyebrow: eventCenterLabel(event),
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
    if(selectedSession?selectedSession.full:event.full){renderImpact();return;}
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
  if(consentConfirmed){consent.control.checked=true;await submit();}
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

    const authenticated=isSignedIn();
    let participant={},records=[],profileError=null,recordsError=null;
    if(authenticated){
      try{({account:participant}=await getAccountProfile());}catch(error){profileError=error;}
      try{records=eventRegistrations((await portal.me()).registrations,event);}catch(error){recordsError=error;}
    }
    let selectedSession=event.sessions.find(session=>!session.full)||event.sessions[0]||null;
    const signupSlot=h('div',{class:'stack-3'});
    const wishes=activityWishlist({authenticated,onChange:()=>updateBooking(),loginHref:()=>loginHref()});
    const consent=checkbox({name:'participation-notice',label:'我已阅读参与须知，确认报名此活动',description:'提交前请再次核对活动地点与时间。',onChange:()=>updateBooking()});
    const registerButton=button({label:'确认报名此活动',variant:'primary',block:true,onClick:()=>{
      if(!consent.control.checked)return;
      return openRegistrationDrawer(event,{sessionId:selectedSession?.sessionId,consentConfirmed:true,onDone:()=>navigate(`/events/${encodeURIComponent(event.eventId)}`,{replace:true})});
    }});
    function updateBooking(){
      const scope=selectedSession||event;
      const full=scope.full||Number(scope.remaining??scope.capacity)<=0;
      const existing=records.find(record=>['已确认','已报名','已签到','候补','待确认','待筛选'].includes(record.status));
      registerButton.disabled=Boolean(existing)||Boolean(recordsError)||full||!consent.control.checked;
      signupSlot.replaceChildren(...(
        existing?[button({label:existing.status==='已签到'?'已签到':existing.status==='候补'?'已加入候补':'已报名',disabled:true,block:true,variant:'secondary'})]:
        recordsError?[notice('报名记录暂未读取成功，请重试后再报名。',{tone:'warning'}),button({label:'重新读取报名记录',variant:'secondary',onClick:()=>navigate(`/events/${encodeURIComponent(event.eventId)}`,{replace:true})})]:
        event.status!=='报名中'?[button({label:'报名已关闭',disabled:true,block:true,variant:'secondary'})]:
        full?[wishes.fullSignup(event)]:
        !authenticated?[button({label:'登录后报名',href:loginHref(),variant:'primary',block:true})]:
        profileError?[notice('个人资料暂未读取成功，请刷新后重试。',{tone:'warning'})]:
        !participant.realName||!participant.emailVerified||!participant.campus?[notice('请先在会员中心完善姓名、校区和邮箱验证。',{tone:'warning'}),button({label:'完善个人资料',href:'/me',variant:'secondary'})]:
        [consent,registerButton,h('p',{class:'t-caption',text:'报名结果以提交时的实际情况为准。'})]
      ));
    }
    const sessionSlot=event.sessions.length>1?sessionChoices(event,selectedSession?.sessionId,session=>{selectedSession=session;consent.control.checked=false;updateBooking();}):null;
    const detail=activityRegistrationDetail({
      event:{...event,work:event.description},participant,authenticated,signup:signupSlot,extra:sessionSlot,
      facts:activityFacts([
        {label:'活动时间',value:event.schedule||fmt.dateRange(event.startAt,event.endAt),iconName:'calendar'},
        {label:'活动地点',value:[event.campus,event.location].filter(Boolean).join(' · ')||'待公布',iconName:'pin'},
        {label:'报名截止',value:fmt.fullDateTime(event.registrationEnd)||'以活动通知为准',iconName:'clock'},
        {label:'报名名额',value:`剩余 ${event.remaining} / ${event.capacity} 人`,iconName:'users'},
      ]),
    });
    const mine=authenticated?panel({title:'我的报名与签到',body:h('div',{class:'stack-4'},
      ...registrationsNewestFirst(records).map(record=>h('section',{class:'blood-registration'},
        h('div',{class:'blood-registration__heading'},h('h3',{text:record.eventName}),badge(record.status)),
        activityFacts([{label:'活动时间',value:fmt.fullDateTime(record.startAt),iconName:'calendar'},{label:'地点',value:record.location,iconName:'pin'}]),
        copyableCode(record.code,{label:'复制报名编号'}),button({label:'查看报名与签到状态',href:'/status',variant:'secondary'}))),
      recordsError?notice('报名记录暂未读取成功，请刷新重试。',{tone:'warning'}):!records.length?h('p',{text:'尚未报名此活动。'}):null)}):null;
    node.className='view formpage stack-6 workflow-page';
    node.replaceChildren(h('a',{class:'workflow-back',href:'/events'},icon('chevronLeft','ico ico--sm'),h('span',{text:'活动广场'})),detail,mine,wishes.node);
    updateBooking();
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
