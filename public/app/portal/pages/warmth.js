/* ==========================================================================
   portal/pages/warmth.js
   Task: understand what "温暖连接" actually does before opting in.
   Consent is the product here, so the guarantees come before the form.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { publicApi, portal, ApiError, getSessionState } from '../../core/api.js';
import { shake, stagger } from '../../core/motion.js';
import { openDrawer } from '../../ui/overlay.js';
import { navigate } from '../../core/router.js';
import { button, field, checkbox, notice, receipt, badge, segmented, timeline, runWithLoading, copyableCode, definitionList, statusIndicator } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import { isSignedIn, loginHref, redirectIfAuthError } from '../auth-gate.js';
import { openBlessingDrawer } from '../blessing-drawer.js';
import { buildWrittenBlessingsPanel, buildReceivedBlessingsPanel, openReceivedBlessingDetail } from '../warmth-panels.js';
import { BIRTHDAY_CAMPUS_OPTIONS as CAMPUS_OPTIONS, BIRTHDAY_MONTH_OPTIONS as MONTH_OPTIONS, birthdayDayOptions as dayOptions } from '../warmth-options.js';

/** Shown when the member joins and while they have not earned a private blessing yet. */
const PRIVATE_BLESSING_RULE = '现在你会先收到红会准备的基础模板祝福。如果你也想收到同学亲手为你写的私人祝福，可以先为别人写一条；通过审核后，这份温暖就会按规则回到你身边。';

const PROGRAMS = [
  {
    id: 'birthday',
    name: '生日祝福',
    iconName: 'sparkle',
    summary: '生日祝福计划让同学在站内写下祝福、经人工审核后由平台转达。当前先开放投稿与审核，匹配和发送仍在建设。',
    collects: ['生日的月和日（不需要年份）', '校区', '联系邮箱（来自账号，只读）'],
    never: ['不读取成员表中的已有生日', '不收集手机号、微信或 QQ', '不把你的邮箱交给投稿人'],
  },
  {
    id: 'morning',
    name: '早安晚安 · 同行计划',
    iconName: 'handshake',
    summary: '以 7 天为一期的轻量同伴陪伴。当前先开放参与登记与人工审核，匹配与转达仍在建设。',
    collects: ['显示昵称', '校区与可联系时段', '兴趣标签（可选）', '联系邮箱'],
    never: ['首版不交换微信、QQ 或手机号', '不使用不可解释的自动匹配', '不会在你退出后继续发送'],
  },
];

function openJoinDrawer(program, { onDone }) {
  const isBirthday = program.id === 'birthday';
  const user = getSessionState().user || {};
  let frequency = 'weekly';

  const nicknameField = field({ label: '显示昵称', name: 'nickname', required: true, placeholder: '其他参与者会看到这个称呼', iconName: 'user' });
  const campusField = isBirthday
    ? field({ label: '校区', name: 'campus', required: true, options: [{ value: '', label: '请选择校区' }, ...CAMPUS_OPTIONS.map((campus) => ({ value: campus, label: campus }))] })
    : field({ label: '校区', name: 'campus', placeholder: '鼓楼 / 仙林 / 苏州 / 浦口' });
  const monthField = isBirthday ? field({ label: '生日（月）', name: 'birthdayMonth', required: true, options: MONTH_OPTIONS, value: '01' }) : null;
  const dayField = isBirthday ? field({ label: '生日（日）', name: 'birthdayDay', required: true, options: dayOptions('01'), value: '01' }) : null;
  if (monthField && dayField) {
    monthField.control.addEventListener('change', () => {
      const previous = dayField.control.value;
      dayField.control.replaceChildren(...dayOptions(monthField.control.value).map((option) => h('option', { value: option.value, text: option.label })));
      if (Number(previous) <= dayField.control.options.length) dayField.control.value = previous;
    });
  }
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
  let deliveredBlessings = [];
  let reportBanner = null;
  let cards = null;
  let blessingEntry = null;
  let blessingPanels = null;
  let refreshToken = 0;

  async function loadState() {
    myBirthday = null;
    myBlessings = [];
    deliveredBlessings = [];
    if (!sessionState.authenticated) return;
    try {
      const payload = await portal.me();
      myBirthday = (payload.enrollments || []).find((item) => item.program === 'birthday' && item.status !== '已退出' && item.status !== '已踢出') || null;
    } catch {
      myBirthday = null;
    }
    if (myBirthday?.status === '已确认') {
      try {
        const blessingPayload = await publicApi.myWarmthBlessings();
        myBlessings = blessingPayload.blessings || [];
      } catch {
        myBlessings = [];
      }
      try {
        const deliveredPayload = await publicApi.deliveredWarmthBlessings();
        deliveredBlessings = deliveredPayload.blessings || [];
      } catch {
        deliveredBlessings = [];
      }
    }
  }

  /**
   * Rebuilds the two fragments whose content depends on the member's enrollment so
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
    return h(
      'div',
      { class: 'programs community-programs' },
      ...PROGRAMS.map((program) =>
        h(
          'div',
          { class: ['program', program.id === 'birthday' ? 'warmth-program warmth-program--birthday' : null].filter(Boolean) },
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
          program.id === 'birthday' && myBirthday
            ? button({
                label: myBirthday.status === '已确认' ? '已加入 · 去会员中心' : '去会员中心查看状态',
                variant: 'secondary',
                iconName: 'user',
                iconAfter: 'arrowRight',
                href: '/me?focus=member-warmth-enrollments',
              })
            : button({
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
                  openJoinDrawer(program, { onDone: refresh });
                },
              }),
        ),
      ),
    );
  }

  function buildBlessingEntry() {
    const approvedBlessingCount = myBlessings.filter((item) => item.status === '已通过').length;
    return h(
      'section',
      { class: 'stack-4' },
      h(
        'div',
        { class: 'section-head' },
        h(
          'div',
          { class: 'section-head__text' },
          h('h2', { class: 't-h2 warmth-letter-panel__title', text: '给同学写一句生日祝福' }),
          h('p', { class: 't-caption', text: '可以写多次。审核通过后，你也会收到陌生人的一对一祝福。' }),
          h('p', { class: 'warmth-letter-panel__hint', text: '写了才会收到别人写的。收到的一对一祝福，最多等于你已通过审核的投稿数。' }),
        ),
      ),
      h(
        'div',
        { class: 'panel warmth-letter-panel' },
        h(
          'div',
          { class: 'panel__body stack-3' },
          h('p', { class: 't-secondary warmth-letter-panel__intro', text: '祝福会先进入人工审核；通过后进入红会祝福库，或按你选择的投递方式转达。' }),
          !sessionState.authenticated
            ? h('div', { class: 'row-3 row-wrap' }, button({ label: '登录后写生日祝福', variant: 'primary', iconName: 'sparkle', href: loginHref(), onClick: () => notify.info('写祝福前请先登录', '登录后祝福会归属到你的账号，审核进度可在会员中心查看。') }))
            : !myBirthday
              ? h('div', { class: 'stack-3' }, notice('只有加入生日祝福计划后，才能写祝福。', { tone: 'warning', title: '还没有加入计划' }), button({ label: '加入生日祝福', variant: 'primary', iconName: 'sparkle', onClick: () => openJoinDrawer(PROGRAMS.find((item) => item.id === 'birthday'), { onDone: refresh }) }))
              : myBirthday.status !== '已确认'
                ? h('div', { class: 'stack-3' }, notice('你的加入记录还没有生效，暂时不能写祝福。可以在会员中心退出后重新加入，或联系管理员。', { tone: 'info', title: '加入未生效' }), button({ label: '去会员中心', variant: 'secondary', iconName: 'user', href: '/me?focus=member-warmth-enrollments' }))
                : h('div', { class: 'stack-3' },
                    approvedBlessingCount
                      ? null
                      : notice(myBlessings.length
                          ? '你写下的祝福还没有通过审核；通过之后，同学写给你的私人祝福也会按规则来到你身边。'
                          : PRIVATE_BLESSING_RULE,
                          { tone: 'info', title: '怎么收到私人祝福' }),
                    h('div', { class: 'row-3 row-wrap' }, button({ label: '写生日祝福', variant: 'primary', iconName: 'sparkle', iconAfter: 'arrowRight', onClick: () => openBlessingDrawer({ onDone: refresh }) })),
                  ),
          sessionState.authenticated
            ? h(
                'div',
                { class: 'row-3 row-wrap' },
                button({
                  label: '查看我的投稿状态',
                  variant: 'secondary',
                  size: 'sm',
                  iconName: 'inbox',
                  iconAfter: 'arrowRight',
                  href: '/me?focus=member-warmth-blessings',
                }),
              )
            : null,
        ),
      ),
    );
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
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (!sessionState.authenticated) return h('div', { hidden: true });
    return h(
      'div',
      { class: 'stack-5' },
      buildWrittenBlessingsPanel(myBlessings, { id: 'community-warmth-blessings', onChanged: refresh }),
      buildReceivedBlessingsPanel(deliveredBlessings, { id: 'community-warmth-delivered', onChanged: refresh }),
    );
  }

  await loadState();
  reportBanner = buildReportBanner();
  cards = buildCards();
  blessingEntry = buildBlessingEntry();
  blessingPanels = buildBlessingPanels();
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
      reportBanner,
      cards,
      blessingEntry,
      blessingPanels,
      h(
        'section',
        { class: 'stack-4' },
        h('div', { class: 'section-head' }, h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '怎样开始参与' }), h('p', { class: 't-caption', text: '选择计划，完成登记，在会员中心查看你的参与记录。' }))),
        timeline([
          { title: '选择喜欢的计划', description: '生日祝福或早安晚安，按自己的节奏参与。', state: 'done', iconName: 'heart' },
          { title: '填写参与信息', description: '生日只需月、日和校区；早安晚安再填写昵称、邮箱与频率。', state: 'active', iconName: 'user' },
          { title: '等待人工审核', description: '在会员中心查看审核进度；当前先做站内记录，邮件转达仍在建设。', iconName: 'mail' },
        ]),
      ),
      notice('如果你在参与过程中感到不适，或收到任何不恰当的内容，请立刻联系管理员。平台当前先做站内审核与记录，举报与冻结流程仍在建设。', { tone: 'warning', title: '遇到问题怎么办' }),
    ),
  );

  return { title: '内建广场', node };
}
