/* ==========================================================================
   console/pages/community.js — warmth programme safety console.
   The emphasis is consent, review and the manual gate before anything is
   sent. Matching produces candidate counts only, never pairings.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { consoleApi, publicApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer, confirmAction } from '../../ui/overlay.js';
import { dataTable } from '../../ui/table.js';
import { asyncRegion, region, reloadAction } from '../lib.js';
import {
  pageHead, metric, metricRow, badge, button, field, checkbox, notice,
  emptyState, segmented, skeletonMetrics, skeletonRows, statusFor, definitionList,
  copyableCode, runWithLoading, timeline, statusIndicator,
} from '../../ui/primitives.js';
import { donutChart } from '../../ui/chart.js';
import { BIRTHDAY_MONTH_OPTIONS, birthdayDayOptions, bindBirthdayMonthDay, BIRTHDAY_CAMPUS_CHOICES } from '../../portal/warmth-options.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const PROGRAM_LABEL = { birthday: '生日祝福', morning: '早安晚安' };
const FREQUENCY_LABEL = { once: '只参加一次', weekly: '按周期接收' };
/** 仍然生效的登记状态（与公众端 isActiveEnrollmentStatus 一致）。 */
const ACTIVE_ENROLLMENT_STATUSES = ['待人工确认', '已确认'];
const SUBMISSION_STATUS_APPROVED = '已通过';

/** Review-queue order: items that still need a human decision come first, closed ones sink. */
const SUBMISSION_REVIEW_ORDER = { 待审核: 0, 等待对方加入: 1, 需修改: 2, 已拒绝: 3 };
function submissionReviewRank(status) {
  return SUBMISSION_REVIEW_ORDER[status] ?? 4;
}

function openMemberDrawer(ref, { onDone } = {}) {
  const slot = h('div', { class: 'stack-4' }, h('p', { class: 't-caption', text: '正在加载成员资料…' }));
  const reasonField = field({ label: '拉黑原因（需要拉黑时填写）', name: 'memberBlacklistReason', multiline: true, rows: 2, maxlength: 500, placeholder: '例如：多次发布不当内容或骚扰他人。' });
  const blacklistButton = button({ label: '拉黑并踢出', variant: 'danger', iconName: 'shield', onClick: () => blacklist() });
  const drawer = openDrawer({
    eyebrow: '温暖连接 · 成员资料',
    title: '成员资料',
    description: '来自平台账号与温暖连接记录；不含身份证、银行卡等敏感字段。',
    width: 520,
    body: [slot, reasonField],
    footer: [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), blacklistButton],
  });
  let member = null;
  async function load() {
    try {
      const payload = await consoleApi.community.warmthMember(ref);
      member = payload.member;
      clear(slot);
      slot.append(
        h('div', { class: 'row-3 row-wrap' }, statusFor(member.warmth.enrollmentStatus), badge(`举报 ${member.warmth.reported} 次`, { tone: member.warmth.reported >= 2 ? 'warning' : 'neutral' }), member.warmth.blacklisted ? badge('已拉黑', { tone: 'error', iconName: 'shield' }) : null),
        definitionList([
          ['真实姓名', member.realName || '—'],
          ['学号', member.studentId || '—'],
          ['联系邮箱', member.email || '—'],
          ['院系', member.department || '—'],
          ['年级', member.grade || '—'],
          ['性别', member.gender || '—'],
          ['身份码', member.memberCode || '—'],
          ['生日（月-日）', member.warmth.birthdayMonthDay || '—'],
          ['加入状态', member.warmth.enrollmentStatus],
          ['加入时间', member.warmth.joinedAt ? fmt.fullDateTime(member.warmth.joinedAt) : '—'],
          ['已通过投稿', `${member.warmth.written} 条`],
          ['已收到祝福', `${member.warmth.received} 条`],
          ['被举报次数', `${member.warmth.reported} 次`],
        ]),
        member.warmth.blacklisted ? notice(`该成员已被拉黑：${member.warmth.blacklistReason || '—'}`, { tone: 'warning', title: '黑名单' }) : null,
      );
      if (member.warmth.blacklisted) blacklistButton.disabled = true;
    } catch (error) {
      clear(slot);
      slot.append(notice(`成员资料无法加载：${error.message || '请稍后重试'}`, { tone: 'warning' }));
    }
  }
  async function blacklist() {
    if (!member) return;
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason) { reasonField.setError('请填写拉黑原因'); shake(reasonField); return; }
    try {
      await runWithLoading(blacklistButton, () => consoleApi.community.blacklistParticipant({ participantRef: member.accountId, reason }));
      notify.success('已拉黑并踢出', member.realName || member.username);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '操作未完成');
    }
  }
  void load();
}

function openBlacklistDrawer(interest, { onDone } = {}) {
  const reasonField = field({ label: '拉黑原因', name: 'blacklistReason', multiline: true, rows: 3, maxlength: 500, required: true, placeholder: '例如：多次发布不当内容或骚扰他人。' });
  const submitButton = button({ label: '拉黑并踢出', variant: 'danger', iconName: 'shield', onClick: () => submit() });
  const drawer = openDrawer({
    eyebrow: '温暖连接 · 拉黑',
    title: interest.nickname || interest.studentId || '拉黑成员',
    description: '拉黑会同时把该成员踢出生日祝福计划，并禁止其重新加入或投稿。',
    width: 480,
    body: [reasonField],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });
  async function submit() {
    reasonField.setError(null);
    const reason = reasonField.control.value.trim();
    if (!reason) { reasonField.setError('请填写拉黑原因'); shake(reasonField); return; }
    try {
      await runWithLoading(submitButton, () => consoleApi.community.blacklistInterest(interest.id, { reason }));
      notify.success('已拉黑并踢出', interest.nickname || interest.studentId);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '操作未完成');
    }
  }
}

function openInterestDrawer(interest, { onDone }) {
  const drawer = openDrawer({
    eyebrow: `${PROGRAM_LABEL[interest.program] || interest.program} · 参与人员`,
    title: interest.nickname || interest.studentId || '参与人员',
    description: `${FREQUENCY_LABEL[interest.frequency] || interest.frequency} · ${fmt.relative(interest.submittedAt)}`,
    width: 480,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(interest.displayStatus || interest.status), badge(`同意版本 v1`, { tone: 'neutral', iconName: 'shield' })),
      definitionList([
        ['登记编号', copyableCode(interest.id)],
        ['项目', PROGRAM_LABEL[interest.program] || interest.program],
        ['真实姓名', interest.realName || '—'],
        ['显示昵称', interest.nickname || '—'],
        ['学号', interest.studentId || '—'],
        ['联系邮箱', interest.contactEmail || '—'],
        ['院系', interest.department || '—'],
        ['年级', interest.grade || '—'],
        ['性别', interest.gender || '—'],
        ['校区', fmt.text(interest.campus)],
        interest.birthdayMonthDay ? ['生日（月-日）', interest.birthdayMonthDay] : null,
        interest.memberCode ? ['身份码', interest.memberCode] : null,
        interest.frequency ? ['接收频率', FREQUENCY_LABEL[interest.frequency] || interest.frequency] : null,
        ['登记时间', fmt.fullDateTime(interest.submittedAt)],
        interest.handledBy ? ['处理人', `${interest.handledBy} · ${fmt.fullDateTime(interest.handledAt)}`] : null,
      ]),
      interest.note ? h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '参与者备注' }), h('div', { class: 'content-preview t-secondary', text: interest.note })) : null,
      notice('加入即进入候选池，加入当天生效。成员撰写的内容仍需经过人工审核，并由管理员确认批次后才会由平台转达。', { tone: 'info', title: '加入的含义' }),
      notice('登记退出会立即把这个人移出候选池与发送队列，且不可被匹配预览统计。', { tone: 'warning', title: '退出的含义' }),
    ].filter(Boolean),
    footer: [
      button({ label: '成员资料', variant: 'secondary', size: 'sm', iconName: 'user', onClick: () => { drawer.close(); openMemberDrawer(interest.studentId, { onDone }); } }),
      h('span', { class: 'spacer' }),
      button({ label: '解除黑名单', variant: 'secondary', size: 'sm', iconName: 'refresh', disabled: !interest.blacklisted, onClick: () => releaseBlacklist() }),
      button({ label: '加入黑名单', variant: 'danger', size: 'sm', iconName: 'shield', disabled: interest.blacklisted, onClick: () => { drawer.close(); openBlacklistDrawer(interest, { onDone }); } }),
    ],
  });
  /** 解除黑名单：把成员移出黑名单，可重新加入计划。 */
  async function releaseBlacklist() {
    const confirmed = await confirmAction({
      title: '解除黑名单？',
      description: `${interest.nickname || interest.studentId} 将被移出黑名单，可以重新加入生日祝福计划。`,
      confirmLabel: '解除黑名单',
    });
    if (!confirmed) return;
    try {
      await consoleApi.community.releaseBlacklist(interest.blacklistId);
      notify.success('已解除黑名单', interest.nickname || interest.studentId || '');
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '操作未完成');
    }
  }
}

function openSubmissionReviewDrawer(submission, { onDone }) {
  let decision = 'approve';
  const actionable = submission.status === '待审核';
  const rejected = submission.status === '已拒绝';
  const noteField = field({ label: '审核意见', name: 'note', multiline: true, rows: 3, maxlength: 500, placeholder: '退回时必须写明原因，例如包含联系方式、语气不当或涉及隐私' });
  const decisionControl = segmented({
    items: [
      { value: 'approve', label: '审核通过' },
      { value: 'return', label: '退回修改' },
      { value: 'reject', label: '直接拒绝' },
    ],
    value: decision,
    ariaLabel: '审核结果',
    onChange: (value) => {
      decision = value;
      decisionControl.setValue(value);
      noteField.setError(null);
      syncSubmitButton();
    },
  });

  const SUBMIT_APPEARANCE = {
    approve: { variant: 'success', label: '通过审核' },
    return: { variant: 'secondary', label: '退回修改' },
    reject: { variant: 'danger', label: '直接拒绝' },
  };
  const submitButton = button({ label: SUBMIT_APPEARANCE[decision].label, variant: SUBMIT_APPEARANCE[decision].variant, iconName: 'check', onClick: () => submit() });

  /** Keeps the footer action aligned with the selected decision (solid green = approve). */
  function syncSubmitButton() {
    const appearance = SUBMIT_APPEARANCE[decision] || SUBMIT_APPEARANCE.approve;
    submitButton.classList.remove('btn--primary', 'btn--secondary', 'btn--ghost', 'btn--danger', 'btn--success');
    submitButton.classList.add(`btn--${appearance.variant}`);
    const labelNode = submitButton.querySelector('span');
    if (labelNode) labelNode.textContent = appearance.label;
  }

  const reopenButton = button({ label: '撤销拒绝并重新审核', variant: 'danger', iconName: 'refresh', onClick: () => reopen() });

  const drawer = openDrawer({
    eyebrow: `${PROGRAM_LABEL[submission.program] || submission.program} · 投稿审核`,
    title: `投稿 ${submission.id}`,
    description: `${submission.tone} · ${fmt.relative(submission.submittedAt)}`,
    width: 500,
    body: [
      h('div', { class: 'row-3 row-wrap' }, statusFor(submission.status), button({ label: submission.actor || '查看投稿人', variant: 'ghost', size: 'sm', iconName: 'user', onClick: () => { drawer.close(); openMemberDrawer(submission.actor, { onDone }); } })),
      definitionList([
        ['署名昵称', submission.nickname || '—'],
        ['投递方式', submission.delivery || '—'],
      ]),
      h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '投稿内容' }), h('div', { class: 'content-preview t-secondary', text: submission.content })),
      actionable ? h('div', { class: 'field' }, h('p', { class: 'field__label', text: '审核结果' }), decisionControl) : null,
      actionable ? noteField : null,
      !actionable ? notice(`当前状态为「${submission.status}」。${rejected ? '如需重新审核，请使用下方的撤销拒绝按钮。' : '该投稿已经完成审核，不能重复提交审核结果。'}`, { tone: rejected ? 'warning' : 'info' }) : null,
      notice('审核通过不会触发匹配或发送。发送仍需管理员在确认批次后逐步执行。', { tone: 'info' }),
    ].filter(Boolean),
    footer: actionable
      ? [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton]
      : rejected
        ? [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }), reopenButton]
        : [h('span', { class: 'spacer' }), button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() })],
  });

  async function submit() {
    noteField.setError(null);
    const note = noteField.control.value.trim();
    if (decision !== 'approve' && !note) {
      noteField.setError(decision === 'reject' ? '直接拒绝必须填写理由' : '退回投稿必须填写审核意见');
      shake(noteField);
      return;
    }
    if (decision === 'reject') {
      const confirmed = await confirmAction({
        title: '直接拒绝这条投稿？',
        description: '拒绝后成员会立即看到结果。如需重新审核，需要管理员先撤销拒绝。',
        confirmLabel: '直接拒绝',
        tone: 'danger',
        details: [`投稿编号：${submission.id}`, `理由：${note}`],
      });
      if (!confirmed) return;
    }
    try {
      const payload = await runWithLoading(submitButton, () => consoleApi.community.reviewSubmission(submission.id, { decision, note }));
      // Approving is the common, low-risk action: confirm it inline on the reviewed row
      // instead of firing a bottom-right toast that competes with the list.
      if (decision !== 'approve') notify.success(decision === 'reject' ? '投稿已直接拒绝' : '投稿已退回', payload.message);
      drawer.close();
      onDone?.({ decision, id: submission.id });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        noteField.setError(error.message);
        shake(noteField);
        return;
      }
      reportError(error, '审核未完成');
    }
  }

  async function reopen() {
    const confirmed = await confirmAction({
      title: '撤销拒绝并重新审核？',
      description: '撤销后这条投稿会回到「待审核」，原拒绝理由会被清空。',
      confirmLabel: '撤销拒绝',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const payload = await runWithLoading(reopenButton, () => consoleApi.community.reviewSubmission(submission.id, { decision: 'reopen', note: '' }));
      notify.success('已撤销拒绝', payload.message);
      drawer.close();
      onDone?.({ decision: 'reopen', id: submission.id });
    } catch (error) {
      reportError(error, '操作未完成');
    }
  }
}
/**
 * 管理员试点加入：与公众端 /api/public/warmth/interest 完全同一套模型——
 * 生日祝福 = 月/日 + 校区（加入即生效）；早安晚安 = 昵称 + 频率 + 校区 + 备注（待人工确认）。
 */
function openJoinDrawer({ onDone }) {
  let program = 'birthday';
  let frequency = 'weekly';

  const programControl = segmented({
    items: [
      { value: 'birthday', label: '生日祝福' },
      { value: 'morning', label: '早安晚安' },
    ],
    value: program,
    ariaLabel: '项目',
    role: 'radiogroup',
    onChange: (value) => { program = value; programControl.setValue(value); sync(); },
  });

  const monthField = field({ label: '生日（月）', name: 'birthdayMonth', required: true, options: BIRTHDAY_MONTH_OPTIONS, value: '01' });
  const dayField = field({ label: '生日（日）', name: 'birthdayDay', required: true, options: birthdayDayOptions('01'), value: '01' });
  bindBirthdayMonthDay(monthField.control, dayField.control);
  const campusField = field({ label: '校区', name: 'campus', required: true, options: BIRTHDAY_CAMPUS_CHOICES });
  const nicknameField = field({ label: '显示昵称', name: 'nickname', required: true, placeholder: '其他参与者会看到这个称呼' });
  const frequencyControl = segmented({
    items: [
      { value: 'weekly', label: '按周期接收' },
      { value: 'once', label: '只参加一次' },
    ],
    value: frequency,
    ariaLabel: '接收频率',
    role: 'radiogroup',
    onChange: (value) => { frequency = value; frequencyControl.setValue(value); },
  });
  const noteField = field({ label: '可联系时段与兴趣标签', name: 'note', multiline: true, rows: 2, maxlength: 300, placeholder: '例如：晚上 9 点后有空；喜欢跑步、摄影' });

  const birthdayBlock = h('div', { class: 'stack-3' }, h('div', { class: 'formgrid' }, monthField, dayField), campusField);
  const morningBlock = h('div', { class: 'stack-3' }, nicknameField, h('div', { class: 'field' }, h('p', { class: 'field__label', text: '接收频率' }), frequencyControl), campusField, noteField);
  function sync() {
    const isBirthday = program === 'birthday';
    birthdayBlock.hidden = !isBirthday;
    morningBlock.hidden = isBirthday;
  }
  sync();

  const consent = checkbox({
    name: 'consent',
    label: '我自愿参加，并确认可以随时退出',
    description: '生日祝福加入后即时生效；早安晚安登记后由人工确认。',
  });

  const submitButton = button({ label: '记录参加意愿', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    eyebrow: '温暖连接 · 管理员试点',
    title: '加入项目',
    description: '与公众端使用同一套登记逻辑。',
    width: 460,
    body: [
      h('div', { class: 'field' }, h('p', { class: 'field__label', text: '项目' }), programControl),
      birthdayBlock,
      morningBlock,
      consent,
    ],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });

  async function submit() {
    if (!consent.control.checked) {
      shake(consent);
      notify.warning('需要明确同意', '请先确认自愿参加与随时退出的规则。');
      return;
    }
    const body = program === 'birthday'
      ? { program, birthdayMonthDay: `${monthField.control.value}-${dayField.control.value}`, campus: campusField.control.value, consent: true }
      : { program, nickname: nicknameField.control.value.trim(), frequency, campus: campusField.control.value, note: noteField.control.value.trim(), consent: true };
    try {
      const payload = await runWithLoading(submitButton, () => publicApi.warmthInterest(body));
      notify.success(program === 'birthday' ? '已加入生日祝福计划' : '已提交参加意愿', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      reportError(error, '未能记录参加意愿');
    }
  }
}

export default async function communityPage(context, shell) {
  let tab = context.query.get('tab') || 'interests';
  if (tab === 'blacklist') tab = 'interests';
  const bodySlot = h('div', { class: 'stack-6' });

  const tabControl = segmented({
    items: [
      { value: 'interests', label: '参与人员' },
      { value: 'submissions', label: '投稿池审核' },
      { value: 'reports', label: '举报处理' },
      { value: 'library', label: '祝福库' },
      { value: 'matching', label: '匹配预览' },
      { value: 'pilot', label: '我的参与' },
    ],
    value: tab,
    ariaLabel: '温暖连接视图',
    onChange: (value) => {
      tab = value;
      tabControl.setValue(value);
      renderTab();
    },
  });

  // 「参与人员」：参加登记 + 黑名单记录合并在同一页签下（两个接口并行加载）
  const interestsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '参与人员无法加载',
    load: () => Promise.all([consoleApi.community.interests(), consoleApi.community.warmthBlacklist()]).then(([interests, blacklist]) => ({ interests, blacklist })),
    render: ({ interests: payload, blacklist: blacklistPayload }, { reload }) => {
      const reloadAll = () => { reload(); shell.refreshTodos(); };
      const interestNodes = payload.interests.length
        ? [
            metricRow(
              [
                metric({ label: '登记总数', value: payload.stats.total, unit: '人', animate: false }),
                metric({ label: '正常', value: payload.stats.normal, unit: '人', animate: false }),
                metric({ label: '已退出', value: payload.stats.withdrawn, unit: '人', animate: false }),
                metric({ label: '已拉黑', value: payload.stats.blacklisted, unit: '人', tone: payload.stats.blacklisted ? 'warn' : '', animate: false }),
              ],
              { columns: 4 },
            ),
            dataTable({
              columns: [
                { key: 'realName', label: '姓名 / 昵称', strong: true, render: (row) => h('span', { text: row.realName || row.nickname || '—' }) },
                { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
                { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
                { key: 'department', label: '院系 / 年级', render: (row) => h('span', { class: 't-caption', text: [row.department, row.grade].filter(Boolean).join(' · ') || '—' }) },
                { key: 'campus', label: '校区', render: (row) => h('span', { class: 't-caption', text: fmt.text(row.campus) }) },
                { key: 'contactEmail', label: '联系邮箱', render: (row) => h('span', { class: 't-caption', text: row.contactEmail || '—' }) },
                { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.displayStatus || row.status) },
                { key: 'submittedAt', label: '登记时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
              ],
              rows: payload.interests,
              getKey: (row) => row.id,
              searchPlaceholder: '搜索姓名、学号、项目或邮箱',
              countLabel: (n) => `${n} 条登记`,
              onRowClick: (row) => openInterestDrawer(row, { onDone: reloadAll }),
              // 操作列统一为「拉黑 / 解除拉黑」；查看详情走行点击
              buildRowMenu: (row) => (row.blacklisted || row.kicked
                ? [{
                    label: '解除拉黑',
                    iconName: 'refresh',
                    onSelect: async () => {
                      const confirmed = await confirmAction({ title: '解除黑名单？', description: `${row.realName || row.studentId || '该成员'} 将可以重新加入生日祝福计划。`, confirmLabel: '解除拉黑' });
                      if (!confirmed) return;
                      try {
                        await consoleApi.community.releaseBlacklistByRef({ studentId: row.studentId });
                        notify.success('已解除黑名单', row.realName || row.studentId || '');
                        reloadAll();
                      } catch (error) {
                        reportError(error, '操作未完成');
                      }
                    },
                  }]
                : [{
                    label: '拉黑',
                    iconName: 'shield',
                    variant: 'danger',
                    onSelect: () => openBlacklistDrawer(row, { onDone: reloadAll }),
                  }]),
            }),
            notice('审核端可查看成员的完整联系信息；内容真实发送前仍需管理员逐批确认。', { tone: 'neutral', iconName: 'lock' }),
          ]
        : [
            emptyState({
              iconName: 'handshake',
              title: '还没有参与人员',
              description: '同学在公众端「温暖连接」页面自愿加入后即登记在这里，加入当天生效；平台不会代替任何人加入。',
              actions: [button({ label: '查看公众端页面', variant: 'secondary', iconAfter: 'external', href: '/warmth', data: { native: 'true' } })],
            }),
          ];
      const entries = blacklistPayload?.entries || [];
      const activeBlacklist = entries.filter((entry) => entry.status === '生效');
      const blacklistNodes = [
        h(
          'div',
          { class: 'section-head' },
          h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: '黑名单' }), h('p', { class: 't-caption', text: '拉黑会同时把成员踢出计划，并邮件通知本人；解除后可以重新加入。' })),
        ),
        entries.length
          ? metricRow(
              [
                metric({ label: '生效中', value: activeBlacklist.length, unit: '人', tone: activeBlacklist.length ? 'warn' : '', animate: false }),
                metric({ label: '历史记录', value: entries.length, unit: '条', animate: false }),
              ],
              { columns: 2 },
            )
          : null,
        entries.length
          ? dataTable({
              columns: [
                { key: 'realName', label: '姓名', strong: true, render: (row) => h('span', { text: row.realName || '—' }) },
                { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
                { key: 'reason', label: '拉黑原因', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.reason || '—' }) },
                { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
                { key: 'handledBy', label: '操作人', render: (row) => h('span', { class: 't-caption', text: row.handledBy || '—' }) },
                { key: 'createdAt', label: '拉黑时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.createdAt) }) },
              ],
              rows: entries,
              getKey: (row) => row.id,
              searchPlaceholder: '搜索学号或原因',
              countLabel: (n) => `${n} 条记录`,
              onRowClick: (row) => openMemberDrawer(row.studentId, { onDone: reloadAll }),
              buildRowMenu: (row) => (row.status === '生效'
                ? [{
                    label: '解除拉黑',
                    iconName: 'refresh',
                    onSelect: async () => {
                      const confirmed = await confirmAction({ title: '解除拉黑？', description: `${row.studentId || '该成员'} 将可以重新加入生日祝福计划。`, confirmLabel: '解除拉黑' });
                      if (!confirmed) return;
                      try {
                        await consoleApi.community.releaseBlacklist(row.id);
                        notify.success('已解除拉黑', row.studentId || '');
                        reloadAll();
                      } catch (error) {
                        reportError(error, '操作未完成');
                      }
                    },
                  }]
                : [{
                    label: '拉黑',
                    iconName: 'shield',
                    variant: 'danger',
                    onSelect: () => openMemberDrawer(row.studentId, { onDone: reloadAll }),
                  }]),
            })
          : emptyState({ iconName: 'shield', title: '黑名单为空', description: '在上方「参与人员」里拉黑成员后，记录会出现在这里；可随时解除。' }),
      ];
      return [...interestNodes, ...blacklistNodes];
    },
  });

  // Reviewers may flip the pool between the default "待处理" queue and one that also lists approved rows.
  let submissionsShowApproved = false;

  const submissionsRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(6),
    errorTitle: '投稿池无法加载',
    load: () => consoleApi.community.submissions(),
    render: (payload, { reload }) => {
      const all = payload.submissions || [];
      const approvedCount = all.filter((row) => row.status === SUBMISSION_STATUS_APPROVED).length;
      const rows = (submissionsShowApproved ? all : all.filter((row) => row.status !== SUBMISSION_STATUS_APPROVED))
        .slice()
        .sort((a, b) => submissionReviewRank(a.status) - submissionReviewRank(b.status));
      const approvedToggle = button({
        label: submissionsShowApproved ? '只看待处理' : `查看已通过（${approvedCount}）`,
        variant: 'secondary',
        size: 'sm',
        iconName: submissionsShowApproved ? 'list' : 'eye',
        title: submissionsShowApproved ? '隐藏已通过的投稿' : '显示审核已通过的投稿',
        disabled: !submissionsShowApproved && !approvedCount,
        onClick: () => {
          submissionsShowApproved = !submissionsShowApproved;
          reload();
        },
      });
      if (!all.length) {
        return emptyState({
          iconName: 'inbox',
          title: '投稿池还是空的',
          description: '只有已主动加入项目的参与者才能投稿。投稿会先进入待审核队列，审核通过也不会自动发送。',
        });
      }
      return [
        metricRow(
          [
            metric({ label: '投稿总数', value: payload.stats.total, unit: '条', animate: false }),
            metric({ label: '待审核', value: payload.stats.pending, unit: '条', tone: payload.stats.pending ? 'warn' : '', animate: false }),
            metric({ label: '等待对方', value: payload.stats.waiting, unit: '条', tone: payload.stats.waiting ? 'warn' : '', animate: false }),
            metric({ label: '已通过', value: payload.stats.approved, unit: '条', animate: false }),
            metric({ label: '已拒绝', value: payload.stats.rejected, unit: '条', animate: false }),
          ],
          { columns: 5 },
        ),
        dataTable({
          columns: [
            { key: 'id', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
            { key: 'content', label: '内容摘要', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'tone', label: '语气' },
            { key: 'nickname', label: '署名昵称', render: (row) => h('span', { class: 't-caption', text: row.nickname || '—' }) },
            { key: 'delivery', label: '投递方式', render: (row) => h('span', { class: 't-caption', text: row.delivery || '—' }) },
            { key: 'deliveryState', label: '投递条件', render: (row) => h('span', { class: 't-caption', text: row.deliveryState || '—' }) },
            { key: 'actor', label: '投稿人' },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索内容、项目或投稿人',
          actions: [approvedToggle],
          countLabel: (n) => (submissionsShowApproved
            ? `${n} 条（含 ${approvedCount} 条已通过）`
            : approvedCount ? `${n} 条待处理 · 已隐藏 ${approvedCount} 条已通过` : `${n} 条投稿`),
          empty: emptyState({
            iconName: 'inbox',
            title: '没有待处理的投稿',
            description: `审核已通过的 ${approvedCount} 条投稿已隐藏，可点击“查看已通过”查看。`,
          }),
          onRowClick: (row) =>
            openSubmissionReviewDrawer(row, {
              onDone: async () => {
                await reload();
                shell.refreshTodos();
              },
            }),
        }),
      ];
    },
  });

  const libraryRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '祝福库无法加载',
    load: () => consoleApi.community.blessingLibrary(),
    render: (payload) => {
      if (!payload.items.length) {
        return emptyState({
          iconName: 'archive',
          title: '祝福库还是空的',
          description: '投稿审核通过后会自动入库，并按投递方式分为祝福仓库 / 一对一随机两类。',
        });
      }
      return [
        metricRow(
          [
            metric({ label: '在库总数', value: payload.stats.active, unit: '条', animate: false }),
            metric({ label: '祝福仓库', value: payload.stats.repository, unit: '条', animate: false }),
            metric({ label: '一对一随机', value: payload.stats.random, unit: '条', animate: false }),
          ],
          { columns: 3 },
        ),
        dataTable({
          columns: [
            { key: 'submissionId', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.submissionId }) },
            { key: 'category', label: '分类', render: (row) => badge(row.category, { tone: 'accent' }) },
            { key: 'content', label: '内容', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'nickname', label: '署名昵称', render: (row) => h('span', { class: 't-caption', text: row.nickname || '—' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => badge(row.status, { tone: row.status === '在库' ? 'success' : 'neutral', iconName: row.status === '在库' ? 'check' : null }) },
            { key: 'storedAt', label: '入库时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.storedAt) }) },
          ],
          rows: payload.items,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索内容、分类或昵称',
          countLabel: (n) => `${n} 条在库记录`,
        }),
        notice('分类入库只做归档，不会自动发送或匹配；真正的投递与配额仍待实现。', { tone: 'neutral', iconName: 'lock' }),
      ];
    },
  });

  const reportsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '举报无法加载',
    load: () => consoleApi.community.warmthReports(),
    render: (payload, { reload }) => {
      if (!payload.reports.length) {
        return emptyState({ iconName: 'alert', title: '还没有举报', description: '成员在收到的祝福详情里举报后，会出现在这里等待处理。' });
      }
      return [
        metricRow(
          [
            metric({ label: '举报总数', value: payload.stats.total, unit: '条', animate: false }),
            metric({ label: '待处理', value: payload.stats.pending, unit: '条', tone: payload.stats.pending ? 'warn' : '', animate: false }),
            metric({ label: '已处理', value: payload.stats.handled, unit: '条', animate: false }),
            metric({ label: '已驳回', value: payload.stats.dismissed, unit: '条', animate: false }),
          ],
          { columns: 4 },
        ),
        dataTable({
          columns: [
            { key: 'id', label: '举报编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.id }) },
            { key: 'submissionId', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.submissionId }) },
            { key: 'content', label: '被举报祝福', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content || '—' }) },
            { key: 'reason', label: '举报理由', render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.reason }) },
            { key: 'reporterStudentId', label: '举报人学号', render: (row) => h('span', { class: 't-data', text: row.reporterStudentId || '—' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(row.status) },
            { key: 'submittedAt', label: '提交时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
          ],
          rows: payload.reports,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索举报理由或编号',
          countLabel: (n) => `${n} 条举报`,
          onRowClick: (row) => openReportDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }),
          buildRowMenu: (row) => [
            { label: '处理举报', iconName: 'shield', onSelect: () => openReportDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }) },
          ],
        }),
        notice('受理成立会把该条祝福从祝福库撤下（不再参与匹配或投递）。', { tone: 'neutral', iconName: 'shield' }),
      ];
    },
  });


  const matchingRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(4),
    errorTitle: '匹配预览无法加载',
    load: () => consoleApi.community.matchingPreview(),
    render: (payload) => [
      notice(payload.message, { tone: 'warning', iconName: 'alert', title: '预览模式：不创建关系、不发送消息' }),
      h(
        'div',
        { class: 'wscols' },
        h(
          'div',
          { class: 'stack-6' },
          region({
            label: '候选统计',
            title: `共 ${payload.candidateCount} 位候选参与者`,
            description: '只统计已明确同意且未退出的参与者数量，不生成任何配对关系。',
            dense: true,
            body: h(
              'div',
              { class: 'stack-4' },
              ...payload.byProgram.map((entry) =>
                h(
                  'div',
                  { class: 'stack-2' },
                  h('div', { class: 'row-between' }, h('span', { class: 't-secondary t-strong', text: PROGRAM_LABEL[entry.program] || entry.program }), h('span', { class: 't-data', text: `${entry.eligible} 人` })),
                  h('p', { class: 't-caption', text: `其中按周期接收 ${entry.weekly} 人` }),
                ),
              ),
            ),
          }),
        ),
        h(
          'div',
          { class: 'stack-6' },
          region({
            label: '构成',
            title: '候选分布',
            dense: true,
            body: payload.candidateCount
              ? donutChart({
                  segments: payload.byProgram.map((entry, index) => ({
                    label: PROGRAM_LABEL[entry.program] || entry.program,
                    value: entry.eligible,
                    color: index === 0 ? 'var(--accent)' : 'var(--info)',
                  })),
                  centerValue: payload.candidateCount,
                  centerLabel: '候选总数',
                })
              : emptyState({ iconName: 'users', title: '还没有候选参与者', description: '需要有人自愿加入并被确认后才会进入候选统计。' }),
          }),
          region({
            label: '生成时间',
            title: '预览快照',
            dense: true,
            body: definitionList([
              ['生成时间', fmt.fullDateTime(payload.generatedAt)],
              ['模式', payload.mode],
              ['配对关系', `${payload.pairs.length} 组（始终为 0）`],
              ['人工确认', payload.requiresManualApproval ? '必需' : '不需要'],
            ]),
          }),
        ),
      ),
    ],
  });

  const pilotRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(3),
    errorTitle: '试点状态无法加载',
    load: () => consoleApi.community.overview(),
    render: (payload, { reload }) => [
      metricRow(
        [
          metric({ label: '当前有效同意', value: payload.stats.active, unit: '条', animate: false }),
          metric({ label: '我参与的项目', value: payload.stats.currentUserActive, unit: '个', animate: false }),
        ],
        { columns: 2 },
      ),
      payload.current.length
        ? h(
            'div',
            { class: 'stack-3' },
            ...payload.current.map((entry) =>
              h(
                'div',
                { class: 'row-3 pilot-row' },
                icon(entry.program === 'birthday' ? 'sparkle' : 'handshake', 'ico ico--lg'),
                h(
                  'div',
                  { class: 'stack-1 spacer' },
                  h('b', { class: 't-secondary t-strong', text: PROGRAM_LABEL[entry.program] || entry.program }),
                  h('p', { class: 't-caption', text: [
                    entry.program === 'birthday' && entry.birthdayMonthDay ? `生日 ${entry.birthdayMonthDay}` : '',
                    entry.program !== 'birthday' && entry.frequency ? (FREQUENCY_LABEL[entry.frequency] || entry.frequency) : '',
                    entry.campus,
                    entry.submittedAt ? `更新于 ${fmt.relative(entry.submittedAt)}` : '',
                  ].filter(Boolean).join(' · ') }),
                ),
                statusIndicator(entry.status || '未知', { tone: entry.status === '已确认' ? 'success' : ['已退出', '已踢出'].includes(entry.status) ? 'neutral' : 'warning' }),
                ACTIVE_ENROLLMENT_STATUSES.includes(entry.status)
                  ? button({
                      label: '退出项目',
                      variant: 'danger',
                      size: 'sm',
                      iconName: 'close',
                      onClick: async () => {
                        const confirmed = await confirmAction({
                          title: `退出${PROGRAM_LABEL[entry.program]}？`,
                          description: '退出后不会再进入匹配与发送队列。你随时可以重新加入。',
                          confirmLabel: '退出项目',
                          tone: 'danger',
                        });
                        if (!confirmed) return;
                        try {
                          await publicApi.withdrawWarmthInterest(entry.id);
                          notify.success('已退出项目');
                          reload();
                        } catch (error) {
                          reportError(error, '退出未完成');
                        }
                      },
                    })
                  : null,
              ),
            ),
          )
        : emptyState({
            iconName: 'heart',
            title: '你还没有参加任何温暖连接项目',
            description: '管理员也可以作为普通参与者加入，用来验证登记、审核与退出流程是否顺畅。',
            actions: [button({ label: '加入项目', variant: 'primary', iconName: 'plus', onClick: () => openJoinDrawer({ onDone: reload }) })],
          }),
      payload.current.length ? button({ label: '加入另一个项目', variant: 'secondary', iconName: 'plus', onClick: () => openJoinDrawer({ onDone: reload }) }) : null,
    ],
  });

  function openReportDrawer(report, { onDone }) {
    const noteField = field({ label: '处理意见', name: 'reportNote', multiline: true, rows: 3, maxlength: 500, placeholder: '受理时必须说明处理方式，例如：已核实并撤下该祝福。' });
    const handleButton = button({ label: '受理并撤下', variant: 'danger', iconName: 'alert', onClick: () => submit('handle') });
    const dismissButton = button({ label: '驳回举报', variant: 'secondary', iconName: 'close', onClick: () => submit('dismiss') });
    const drawer = openDrawer({
      eyebrow: '生日祝福 · 举报处理',
      title: `举报 ${report.id}`,
      description: `投稿 ${report.submissionId} · ${fmt.relative(report.submittedAt)}`,
      width: 480,
      body: [
        h('div', { class: 'row-3 row-wrap' }, statusFor(report.status), button({ label: `举报人 ${report.reporterStudentId || '—'}`, variant: 'ghost', size: 'sm', iconName: 'user', onClick: () => { drawer.close(); openMemberDrawer(report.reporterStudentId, { onDone }); } })),
        h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '被举报祝福' }), h('div', { class: 'content-preview t-secondary', text: report.content || '（原文不可用）' }), h('p', { class: 't-caption t-muted', text: [report.nickname ? `署名：${report.nickname}` : '', report.category ? `分类：${report.category}` : '', report.author ? `投稿人：${report.author}` : ''].filter(Boolean).join(' · ') })),
        h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '举报理由' }), h('div', { class: 'content-preview t-secondary', text: report.reason })),
        report.authorReportCount >= 2 ? notice(`该作者已被举报 ${report.authorReportCount} 次，建议核实后拉黑（拉黑会一并踢出计划并邮件告知本人）。`, { tone: 'warning', title: '多次被举报' }) : null,
        noteField,
        notice('受理成立会把该条祝福从祝福库撤下（不再参与匹配或投递）。', { tone: 'warning' }),
      ],
      footer: [
        report.authorRef ? button({ label: '被举报人资料', variant: 'primary', size: 'sm', iconName: 'user', onClick: () => { drawer.close(); openMemberDrawer(report.authorRef, { onDone }); } }) : null,
        report.authorReportCount >= 2 && report.authorRef ? button({ label: '拉黑该作者', variant: 'danger', size: 'sm', iconName: 'shield', onClick: () => blacklistAuthor(report, { onDone }) }) : null,
        h('span', { class: 'spacer' }),
        dismissButton,
        handleButton,
      ].filter(Boolean),
    });
    async function blacklistAuthor(target, { onDone: afterDone }) {
      const confirmed = await confirmAction({
        title: '拉黑该投稿人？',
        description: `${target.author || '该作者'} 已被举报 ${target.authorReportCount} 次；拉黑会同时踢出其生日祝福计划，并邮件告知本人。`,
        confirmLabel: '拉黑并踢出',
        tone: 'danger',
        details: [`最近一次举报理由：${target.reason}`],
      });
      if (!confirmed) return;
      try {
        await consoleApi.community.blacklistParticipant({ participantRef: target.authorRef, reason: `多次被举报：${target.reason}` });
        notify.success('已拉黑该成员', target.author || '');
        drawer.close();
        afterDone?.();
      } catch (error) {
        reportError(error, '操作未完成');
      }
    }

    async function submit(action) {
      noteField.setError(null);
      const note = noteField.control.value.trim();
      if (action === 'handle' && !note) { noteField.setError('受理举报必须填写处理意见'); shake(noteField); return; }
      try {
        await runWithLoading(action === 'handle' ? handleButton : dismissButton, () => consoleApi.community.decideWarmthReport(report.id, action, { note }));
        notify.success(action === 'handle' ? '举报已受理' : '举报已驳回', action === 'handle' ? '该祝福已从祝福库撤下。' : '已记录驳回结论。');
        drawer.close();
        onDone?.();
      } catch (error) {
        reportError(error, '处理未完成');
      }
    }
  }

  function renderTab() {
    clear(bodySlot);
    const current = tab === 'submissions' ? submissionsRegion : tab === 'reports' ? reportsRegion : tab === 'library' ? libraryRegion : tab === 'matching' ? matchingRegion : tab === 'pilot' ? pilotRegion : interestsRegion;
    current.ensureLoaded();
    bodySlot.append(h('div', { class: 'row-3 row-wrap' }, tabControl, h('span', { class: 'spacer' }), reloadAction(current, '刷新')), current);
    requestAnimationFrame(() => tabControl.reposition?.());
  }

  const node = h(
    'div',
    { class: 'view wspad wspad--wide' },
    pageHead({
      label: '温暖连接',
      title: '安全互动控制台',
      description: '这个模块的重点不是匹配结果，而是同意、审核、退出与举报是否都处在可控状态。默认不自动发送任何内容。',
      meta: [statusIndicator('默认不自动发送', { tone: 'warning' })],
      actions: [button({ label: '公众端项目页', variant: 'ghost', iconAfter: 'external', href: '/warmth', data: { native: 'true' } })],
    }),
    bodySlot,
  );

  renderTab();
  return { title: '温暖连接', crumb: '温暖连接', node };
}
