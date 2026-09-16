/* ==========================================================================
   portal/pages/event-detail.js
   Task: understand one activity and complete registration without leaving the
   page. Registration runs in a drawer with an explicit impact preview and a
   downloadable credential as the result state.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { expandFromOrigin, shake, stagger } from '../../core/motion.js';
import { navigate } from '../../core/router.js';
import { openDrawer } from '../../ui/overlay.js';
import {
  button, badge, statusIndicator, field, checkbox, notice, receipt, barTrack,
  emptyState, errorState, skeletonBlock, steps, copyableCode, runWithLoading,
} from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { eventCard } from './home.js';

function factCell(label, value) {
  return h('div', { class: 'pdetail__fact' }, h('p', { class: 't-label', text: label }), h('p', { class: 't-secondary t-strong', text: value }));
}

function openRegistrationDrawer(event, { onDone }) {
  let selectedSession = event.sessions.find((session) => !session.full) || event.sessions[0] || null;
  const stepSlot = h('div', null, steps(['填写信息', '确认授权', '完成'], 0));

  const nameField = field({ label: '姓名', name: 'name', required: true, placeholder: '与校园卡一致，便于现场核验', iconName: 'user' });
  const emailField = field({
    label: '校内邮箱',
    name: 'email',
    type: 'email',
    required: true,
    placeholder: 'your_id@smail.nju.edu.cn',
    hint: '用于接收报名确认与候补递补通知，也是查询状态的凭据。',
    iconName: 'mail',
  });
  const campusField = field({ label: '校区', name: 'campus', placeholder: '鼓楼 / 仙林 / 苏州', value: event.campus || '' });
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
          aria: { checked: String(selectedSession?.sessionId === session.sessionId), disabled: session.full && session.remaining === 0 ? null : null },
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
    description: '信息仅用于本次活动的名额确认、现场签到与必要通知；不会在公开页面展示，也不会用于其他用途。你可以随时通过「我的状态」查询或联系管理员取消。',
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

  async function submit() {
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
        notice('如果无法参加，请尽早在「我的状态」中联系管理员取消，让候补同学能够顺利递补。', { tone: 'info' }),
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
    }
  }
}

export default async function eventDetailPage(context) {
  const mainSlot = h('div', { class: 'pdetail__main' }, skeletonBlock('220px'), skeletonBlock('160px'));
  const asideSlot = h('aside', { class: 'pdetail__aside' }, skeletonBlock('220px'));

  const node = h(
    'div',
    { class: 'view' },
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
    title = event.name;

    const registrationOpen = event.status === '报名中';
    const registerButton = button({
      label: registrationOpen ? (event.full ? '加入候补队列' : '立即报名') : '报名已关闭',
      variant: registrationOpen ? 'primary' : 'secondary',
      size: 'lg',
      block: true,
      iconName: registrationOpen ? 'check' : 'lock',
      disabled: !registrationOpen,
      onClick: () => openRegistrationDrawer(event, { onDone: () => navigate(`/events/${encodeURIComponent(event.eventId)}`, { replace: true }) }),
    });

    mainSlot.replaceChildren(
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
        event.description ? h('p', { class: 't-prose t-title', text: event.description }) : null,
      ),
      h(
        'div',
        { class: 'pdetail__facts' },
        factCell('活动时间', fmt.dateRange(event.startAt, event.endAt)),
        factCell('地点', [event.campus, event.location].filter(Boolean).join(' · ') || '待公布'),
        factCell('报名截止', fmt.fullDateTime(event.registrationEnd)),
        factCell('容量', event.capacity ? `${event.confirmed} / ${event.capacity} 人` : '不限'),
      ),
      event.sessions.length
        ? h(
            'section',
            { class: 'stack-4' },
            h('div', { class: 'section-head' }, h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '场次安排' }), h('p', { class: 't-caption', text: '报名时可以选择具体场次，名额分别计算。' }))),
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
          )
        : null,
      h(
        'section',
        { class: 'stack-4' },
        h('div', { class: 'section-head' }, h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '参加须知' }))),
        h(
          'div',
          { class: 'stack-3' },
          notice('请携带校园卡或学生证，现场出示报名二维码或报名编号完成签到。', { tone: 'info', iconName: 'qr' }),
          notice('名额已满时可以加入候补。前面的同学取消后，系统会按候补顺序递补并通过邮箱通知。', { tone: 'neutral', iconName: 'users' }),
          notice('报名信息仅用于本次活动的名额确认、签到与必要通知，不会在公开页面展示。', { tone: 'neutral', iconName: 'lock' }),
        ),
      ),
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
        { class: 'panel panel--raised' },
        h(
          'div',
          { class: 'panel__body stack-4' },
          h(
            'div',
            { class: 'stack-2' },
            h('p', { class: 't-label', text: '报名情况' }),
            h('div', { class: 'row-base row-2' }, h('b', { class: 't-h1 t-num', text: String(event.confirmed) }), h('span', { class: 't-caption', text: event.capacity ? `/ ${event.capacity} 人已确认` : '人已确认' })),
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
          h('p', { class: 't-caption', text: registrationOpen ? '报名成功后立即生成签到凭证，可在「我的状态」中随时查询。' : '该活动已不再接受新的报名。' }),
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
  } catch (error) {
    mainSlot.replaceChildren(
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
