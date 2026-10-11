/* ==========================================================================
   portal/pages/warmth.js
   Task: understand what "温暖连接" actually does before opting in.
   Consent is the product here, so the guarantees come before the form.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { publicApi, portal, morningApi, ApiError, getSessionState } from '../../core/api.js';
import { shake, stagger, prefersReducedMotion } from '../../core/motion.js';
import { openDrawer } from '../../ui/overlay.js';
import { navigate } from '../../core/router.js';
import { button, field, checkbox, notice, receipt, badge, segmented, runWithLoading, copyableCode, definitionList, statusIndicator } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { isSignedIn, loginHref, redirectIfAuthError } from '../auth-gate.js';
import { openBlessingDrawer } from '../blessing-drawer.js';
import { buildWrittenBlessingsPanel, buildReceivedBlessingsPanel, openReceivedBlessingDetail } from '../warmth-panels.js';
import { BIRTHDAY_CAMPUS_OPTIONS as CAMPUS_OPTIONS, BIRTHDAY_MONTH_OPTIONS as MONTH_OPTIONS, birthdayDayOptions as dayOptions, bindBirthdayMonthDay } from '../warmth-options.js';

/** 兜底默认值；实际以 /api/public/warmth/blessings/mine 返回的 stats.limit 为准（服务端为单一来源）。 */
const WARMTH_SUBMISSION_LIMIT = 3;

/** Shown when the member joins and while they have not earned a private blessing yet. */
const PRIVATE_BLESSING_RULE = '生日当天会按已审核的投稿数量匹配祝福；没有有效投稿时，会从祝福库抽取一条。祝福不足时可能无法送达，你可以先为同学写下祝福。';

const PROGRAMS = [
  {
    id: 'birthday',
    name: '生日祝福',
    iconName: 'sparkle',
    summary: '生日祝福计划让同学在站内写下祝福、经人工审核后由平台转达。投稿通过审核后入库，生日当天由平台启用的投递任务送达。',
    collects: ['生日的月和日（不需要年份）', '校区', '联系邮箱（来自账号，只读）'],
    never: ['不读取成员表中的已有生日', '不收集手机号、微信或 QQ', '不把你的邮箱交给投稿人'],
  },
  {
    id: 'morning',
    name: '早安晚安',
    iconName: 'handshake',
    summary: '用一张同行名片介绍自己。审核通过后，按兴趣认识同学、互留评论，也可以选择通过邮件交流。',
    collects: ['昵称、校区、兴趣标签和简介用于名片展示', '真实姓名、学号和性别用于审核核验'],
    never: ['不向其他成员公开真实姓名和账号资料', '只有你选择附上联系方式时才会随评论邮件提供给对方'],
  },
];

function openJoinDrawer(program, { onDone }) {
  if (program.id === 'morning') {
    navigate('/morning');
    return;
  }
  const isBirthday = program.id === 'birthday';
  const user = getSessionState().user || {};
  let frequency = 'weekly';

  const nicknameField = field({ label: '显示昵称', name: 'nickname', required: true, placeholder: '其他参与者会看到这个称呼', iconName: 'user' });
  const campusField = isBirthday
    ? field({ label: '校区', name: 'campus', required: true, options: [{ value: '', label: '请选择校区' }, ...CAMPUS_OPTIONS.map((campus) => ({ value: campus, label: campus }))] })
    : field({ label: '校区', name: 'campus', placeholder: '鼓楼 / 仙林 / 苏州 / 浦口' });
  const monthField = isBirthday ? field({ label: '生日（月）', name: 'birthdayMonth', required: true, options: MONTH_OPTIONS, value: '01' }) : null;
  const dayField = isBirthday ? field({ label: '生日（日）', name: 'birthdayDay', required: true, options: dayOptions('01'), value: '01' }) : null;
  if (monthField && dayField) bindBirthdayMonthDay(monthField.control, dayField.control);
  const emailField = isBirthday ? null : field({ label: '联系邮箱', name: 'email', type: 'email', required: true, iconName: 'mail', placeholder: 'your_id@smail.nju.edu.cn', hint: '平台只用它转达内容与发送退出确认。' });
  const noteField = isBirthday ? null : field({ label: '可联系时段与兴趣标签', name: 'note', multiline: true, rows: 3, maxlength: 300, placeholder: '例如：晚上 9 点后有空；喜欢跑步、摄影、自习搭子' });
  const frequencyControl = isBirthday ? null : segmented({
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
    description: '所有内容都会先经人工审核再转达。你可以随时在会员中心要求退出；退出后不会再进入任何匹配与发送队列。',
  });

  const submitButton = button({ label: '确认加入', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const body = isBirthday
    ? [
        notice('学号与联系邮箱直接来自你的账号，不能在这里修改。生日只需要「月」和「日」，不会收集出生年份。', { tone: 'info', title: '这次会用到的信息' }),
        definitionList([['学号', user.studentId || '—'], ['联系邮箱', user.email || '—']]),
        h('div', { class: 'formgrid' }, monthField, dayField),
        campusField,
        consent,
      ]
    : [
        notice(`平台会记录：${program.collects.join('、')}。除此之外不收集其他个人信息。`, { tone: 'info', title: '这次会用到的信息' }),
        h('div', { class: 'formgrid' }, nicknameField, emailField),
        campusField,
        h('div', { class: 'field' }, h('p', { class: 'field__label', text: '接收频率' }), frequencyControl),
        noteField,
        consent,
      ];

  const drawer = openDrawer({
    eyebrow: '温暖连接',
    title: `加入${program.name}`,
    description: '自愿加入 · 人工审核 · 随时退出',
    width: 500,
    body,
    footer: [
      h('p', { class: 't-caption t-faint', text: isBirthday ? '生日资料之后可以再次提交更新' : '登记后仍需管理员人工确认' }),
      h('span', { class: 'spacer' }),
      button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }),
      submitButton,
    ],
  });

  async function submit() {
    nicknameField.setError(null);
    emailField?.setError(null);
    campusField.setError(null);
    let invalid = null;
    if (!isBirthday && !nicknameField.control.value.trim()) {
      nicknameField.setError('请填写显示昵称');
      invalid = nicknameField;
    }
    if (isBirthday) {
      if (!campusField.control.value) {
        campusField.setError('请选择校区');
        invalid = invalid || campusField;
      }
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.control.value.trim())) {
      emailField.setError('请填写有效的校内邮箱');
      invalid = invalid || emailField;
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

    const payloadBody = isBirthday
      ? {
          program: program.id,
          nickname: nicknameField.control.value.trim(),
          campus: campusField.control.value,
          birthdayMonthDay: `${monthField.control.value}-${dayField.control.value}`,
          consent: true,
        }
      : {
          program: program.id,
          frequency,
          nickname: nicknameField.control.value.trim(),
          email: emailField.control.value.trim(),
          campus: campusField.control.value.trim(),
          note: noteField.control.value.trim(),
          consent: true,
        };

    try {
      const payload = await runWithLoading(submitButton, () => publicApi.warmthInterest(payloadBody));
      const rows = isBirthday
        ? [
            ['登记编号', payload.interest.id],
            ['项目', program.name],
            ['生日', payloadBody.birthdayMonthDay],
            ['校区', payloadBody.campus],
            ['当前状态', payload.interest.status],
          ]
        : [
            ['登记编号', payload.interest.id],
            ['项目', program.name],
            ['接收频率', frequency === 'weekly' ? '按周期接收' : '只参加一次'],
            ['当前状态', payload.interest.status],
          ];
      drawer.setBody(
        receipt({ title: isBirthday ? '已加入生日祝福计划' : '已记录你的参加意愿', rows }),
        h('div', { class: 'row-3 row-wrap' }, copyableCode(payload.interest.id, { label: '复制登记编号' })),
        isBirthday
          ? notice(PRIVATE_BLESSING_RULE, { tone: 'info', title: '怎么收到私人祝福' })
          : notice('想退出时，请在会员中心操作，记录会立即停止发送。', { tone: 'neutral' }),
      );
      drawer.setFooter(
        isBirthday ? button({ label: '去写生日祝福', variant: 'primary', iconName: 'sparkle', onClick: () => { drawer.close(); openBlessingDrawer({ onDone }); } }) : h('span', { class: 'spacer' }),
        isBirthday ? button({ label: '去会员中心', variant: 'secondary', iconName: 'user', href: '/me?focus=member-warmth-enrollments', onClick: () => drawer.close() }) : h('span', { class: 'spacer' }),
        h('span', { class: 'spacer' }),
        button({ label: '完成', variant: isBirthday ? 'ghost' : 'primary', onClick: () => drawer.close() }),
      );
      notify.success(isBirthday ? '已加入生日祝福计划' : '登记成功', payload.message, { duration: 7000 });
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
  const sessionState = getSessionState();
  let myBirthday = null;
  let myBlessings = [];
  let mySubmissionLimit = WARMTH_SUBMISSION_LIMIT;
  let deliveredBlessings = [];
  let reportBanner = null;
  let cards = null;
  let blessingEntry = null;
  let blessingPanels = null;
  let refreshToken = 0;
  let stateError = false;
  let lettersError = false;
  let morningState = null;
  let morningError = false;

  async function loadState() {
    myBirthday = null;
    myBlessings = [];
    deliveredBlessings = [];
    stateError = false;
    lettersError = false;
    morningError = false;
    if (!sessionState.authenticated) return;
    const [member, morning] = await Promise.allSettled([portal.me(), morningApi.card()]);
    if (member.status === 'fulfilled') {
      myBirthday = (member.value.enrollments || []).find((item) => item.program === 'birthday' && item.status !== '已退出') || null;
    } else stateError = true;
    morningState = morning.status === 'fulfilled' ? morning.value : null;
    morningError = morning.status === 'rejected';
    if (myBirthday?.status === '已确认') {
      const [written, received] = await Promise.allSettled([publicApi.myWarmthBlessings(), publicApi.deliveredWarmthBlessings()]);
      if (written.status === 'fulfilled') {
        myBlessings = written.value.blessings || [];
        mySubmissionLimit = Number(written.value.stats?.limit) || WARMTH_SUBMISSION_LIMIT;
      }
      if (received.status === 'fulfilled') deliveredBlessings = received.value.blessings || [];
      lettersError = written.status === 'rejected' || received.status === 'rejected';
    }
  }

  /**
   * Rebuilds the fragments whose content depends on the member's enrollment so
   * that joining or submitting updates the page in place, without a full reload.
   */
  async function refresh() {
    const token = ++refreshToken;
    await loadState();
    if (token !== refreshToken) return;
    const nextBanner = buildReportBanner();
    const nextCards = buildCards();
    const nextEntry = buildBlessingEntry();
    const nextPanels = buildBlessingPanels();
    reportBanner.replaceWith(nextBanner);
    cards.replaceWith(nextCards);
    blessingEntry.replaceWith(nextEntry);
    blessingPanels.replaceWith(nextPanels);
    reportBanner = nextBanner;
    cards = nextCards;
    blessingEntry = nextEntry;
    blessingPanels = nextPanels;
    stagger(cards);
  }

  function buildCards() {
    return h('div', { class: 'community-programs' }, ...PROGRAMS.map((program) => {
      const birthday = program.id === 'birthday';
      const joined = myBirthday?.status === '已确认';
      const failed = birthday ? stateError : morningError;
      const status = !sessionState.authenticated ? '登录后参与' : failed ? '参与状态暂未读取' : birthday
        ? (myBirthday?.status || '尚未加入') : (morningState?.card?.status || '还没有同行名片');
      const used = myBlessings.filter((item) => item.status !== '已拒绝').length;
      const canWrite = joined && !lettersError && used < mySubmissionLimit;
      const label = failed ? '重新读取状态' : birthday
        ? joined ? canWrite ? '写生日祝福' : '查看我的祝福' : myBirthday ? '查看参与状态' : '加入生日祝福'
        : morningState?.card?.status === '已发布' ? '遇见同行的同学' : morningState?.card ? '查看我的名片' : '创建同行名片';
      return h('article', { class: `community-program community-program--${program.id}`, id: birthday ? 'warmth-write-entry' : null },
        h('div', { class: 'community-program__top' }, h('span', { text: birthday ? '一封祝福 · 一份惦念' : '一声问候 · 一路同行' }), icon(program.iconName, 'ico')),
        h('div', { class: `community-art community-art--${program.id}`, attrs: { 'aria-hidden': 'true' } },
          h('span', { class: 'community-art__paper' }), h('span', { class: 'community-art__seal' })),
        h('div', { class: 'community-program__copy' },
          h('h2', { text: program.name }),
          h('p', { text: birthday ? '把心意写进信里，\n为同学的生日添一份温暖。' : '从一句早安开始，\n找到校园里与你同频的人。' }),
          h('p', { class: 'community-program__description', text: birthday ? '自愿加入，写下祝福。经审核后，由平台转达这份心意。' : '介绍自己，分享兴趣。名片审核通过后，认识同学、互留评论。' })),
        h('div', { class: 'community-program__participation' },
          h('span', { class: 'community-program__status', text: status }),
          button({ label, variant: 'primary', iconAfter: 'arrowRight', onClick: () => {
            if (failed) { void refresh(); return; }
            if (!birthday) { navigate(morningState?.card?.status === '已发布' ? '/morning/plaza' : '/morning'); return; }
            if (!isSignedIn()) { navigate(loginHref()); return; }
            if (joined) { if (canWrite) openBlessingDrawer({ onDone: refresh }); else navigate('/me?focus=member-warmth-blessings'); return; }
            if (myBirthday) { navigate('/me?focus=member-warmth-enrollments'); return; }
            openJoinDrawer(program, { onDone: refresh });
          } })),
        h('details', { class: 'community-program__privacy' },
          h('summary', { text: '参与方式与隐私说明' }),
          h('p', { text: program.summary }),
          h('p', { text: `会用到的信息：${program.collects.join('；')}。` }),
          h('ul', null, ...program.never.map((item) => h('li', { text: item })))));
    }));
  }

  function buildBlessingEntry() {
    if (myBirthday?.status !== '已确认') return h('div', { hidden: true });
    const used = myBlessings.filter((item) => item.status !== '已拒绝').length;
    return h('section', { class: 'community-maildesk' },
      h('div', null, h('span', { class: 'community-eyebrow', text: '只属于你的信笺' }), h('h2', { text: '我的生日祝福' })),
      lettersError
        ? h('div', { class: 'stack-2' }, notice('祝福记录暂未完整读取，请重试后查看。', { tone: 'warning' }), button({ label: '重新读取祝福', variant: 'secondary', onClick: refresh }))
        : h('p', { text: `已占用 ${used} / ${mySubmissionLimit} 条投稿名额。写下的心意与收到的祝福，都收在这里。` }),
      h('details', { class: 'community-maildesk__rules' }, h('summary', { text: '了解祝福投递规则' }), h('p', { text: PRIVATE_BLESSING_RULE })));
  }

  function reportStatusLabel(item) {
    return item.reportStatus === '已处理' ? '已受理' : item.reportStatus === '已驳回' ? '未予受理' : '处理中';
  }
  function reportStatusTone(item) {
    return item.reportStatus === '已处理' ? 'success' : item.reportStatus === '已驳回' ? 'neutral' : 'warning';
  }
  /** 跳转到「我收到的生日祝福」面板并自动展开。 */
  function openReceivedPanel() {
    const panel = document.getElementById('community-warmth-delivered');
    if (!panel) return;
    if (typeof panel.setOpen === 'function') panel.setOpen(true);
    panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'start' });
  }
  /** 有结论的举报（已受理 / 未予受理）才允许举报人「确认」后从置顶横幅收起。 */
  function reportConcluded(item) {
    return item.reportStatus === '已处理' || item.reportStatus === '已驳回';
  }

  async function acknowledgeReport(item, node) {
    if (!item.reportId) return;
    try {
      await runWithLoading(node, () => publicApi.acknowledgeWarmthReport(item.reportId));
      notify.success('已确认', '这条举报不再置顶显示，记录仍保留在「我收到的生日祝福」里。');
      await refresh();
    } catch (error) {
      reportError(error, '确认失败');
    }
  }

  /** 举报受理状态置顶：逐条列出被举报祝福的结论；有结论的可确认后从横幅隐藏，仍可跳到收件面板。 */
  function buildReportBanner() {
    if (!sessionState.authenticated) return h('div', { hidden: true });
    const reported = deliveredBlessings.filter((item) => item.reported && !item.reportAcknowledged);
    if (!reported.length) return h('div', { hidden: true });
    const accepted = reported.filter((item) => item.reportStatus === '已处理').length;
    const pending = reported.filter((item) => !item.reportStatus || item.reportStatus === '待处理').length;
    const overallTone = accepted ? 'success' : pending ? 'warning' : 'neutral';
    return h(
      'section',
      { class: 'panel warmth-report-banner', id: 'community-report-banner', data: { tone: overallTone } },
      h(
        'div',
        { class: 'panel__body stack-3' },
        h(
          'div',
          { class: 'row-3 row-wrap' },
          statusIndicator('我的举报受理状态', { tone: overallTone }),
          h('span', { class: 'spacer' }),
          badge(`${reported.length} 条`, { tone: 'accent' }),
        ),
        h(
          'div',
          { class: 'stack-2' },
          ...reported.map((item) => h(
            'div',
            { class: 'warmth-report-banner__row' },
            h(
              'button',
              {
                class: 'warmth-report-banner__item',
                type: 'button',
                attrs: { 'aria-label': `查看被举报祝福详情（${reportStatusLabel(item)}）` },
                on: { click: () => openReceivedBlessingDetail(item, { onChanged: refresh }) },
              },
              statusIndicator(reportStatusLabel(item), { tone: reportStatusTone(item) }),
              h('span', { class: 't-secondary', text: `${String(item.content || '').slice(0, 36)}${String(item.content || '').length > 36 ? '…' : ''}` }),
              item.reportResolution ? h('span', { class: 't-caption t-muted', text: `· ${item.reportResolution}` }) : null,
            ),
            reportConcluded(item) && item.reportId
              ? button({ label: '确认', variant: 'secondary', size: 'sm', iconName: 'check', ariaLabel: `确认已阅这条举报的结果（${reportStatusLabel(item)}）`, onClick: (event) => acknowledgeReport(item, event.currentTarget) })
              : null,
          )),
        ),
        h('div', { class: 'row-3 row-wrap' }, button({ label: '查看我收到的祝福', variant: 'secondary', size: 'sm', iconAfter: 'arrowRight', onClick: openReceivedPanel })),
      ),
    );
  }

  /** 内建中心也放一份「我写的 / 我收到的」，与会员中心同款可折叠面板。 */
  function buildBlessingPanels() {
    if (!sessionState.authenticated || myBirthday?.status !== '已确认' || lettersError) return h('div', { hidden: true });
    return h(
      'div',
      { class: 'community-mailboxes' },
      buildWrittenBlessingsPanel(myBlessings, { id: 'community-warmth-blessings', onChanged: refresh, joined: myBirthday?.status === '已确认' }),
      buildReceivedBlessingsPanel(deliveredBlessings, { id: 'community-warmth-delivered', onChanged: refresh }),
    );
  }

  await loadState();
  reportBanner = buildReportBanner();
  cards = buildCards();
  blessingEntry = buildBlessingEntry();
  blessingPanels = buildBlessingPanels();
  stagger(cards);
  const node = h('div', { class: 'view community-view' },
    h('div', { class: 'community-page' },
      h('header', { class: 'community-heading' },
        h('div', null, h('p', { class: 'community-eyebrow', text: '内建广场 / 校园里的温暖连接' }),
          h('h1', null, '把温暖，留在', h('br'), h('span', { text: '彼此的日常。' }))),
        h('div', { class: 'community-heading__aside' },
          h('p', { text: '生日里的一封信，日常里的一声问候。\n在这里，让善意有来有往。' }),
          button({ label: '我的温暖连接', href: '/me?view=warmth', variant: 'secondary', iconAfter: 'arrowRight' }))),
      cards, reportBanner, blessingEntry, blessingPanels,
      h('footer', { class: 'community-care' }, icon('heart', 'ico'),
        h('div', null, h('h2', { text: '按自己的节奏，靠近彼此' }),
          h('p', { text: '参与是自愿的，你可以在会员中心调整或退出。收到不恰当的生日祝福，可在信件详情中举报；其他参与问题可向管理员反馈。' })),
        button({ label: '前往会员中心', href: '/me?view=warmth', variant: 'ghost', iconAfter: 'arrowRight' }))));
  return { title: '内建广场', node };
}
