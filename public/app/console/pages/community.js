/* ==========================================================================
   console/pages/community.js — warmth programme safety console.
   The emphasis is consent, review and the manual gate before anything is
   sent. Matching produces candidate counts only, never pairings.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { consoleApi, publicApi, ApiError } from '../../core/api.js';
import { shake } from '../../core/motion.js';
import { openDrawer, confirmAction, openComingSoon } from '../../ui/overlay.js';
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

const PROGRAM_LABEL = { birthday: '生日祝福', morning: '早安晚安（开发中）' };
const FREQUENCY_LABEL = { once: '只参加一次', weekly: '按周期接收' };
/** 仍然生效的登记状态（与公众端 isActiveEnrollmentStatus 一致）。 */
const ACTIVE_ENROLLMENT_STATUSES = ['待人工确认', '已确认'];
const SUBMISSION_STATUS_APPROVED = '已通过';

/** Review-queue order: items that still need a human decision come first, closed ones sink. */
const SUBMISSION_REVIEW_ORDER = { 待审核: 0, 需修改: 1, 已拒绝: 2 };
function submissionReviewRank(status) {
  return SUBMISSION_REVIEW_ORDER[status] ?? 4;
}

/** 每份稿件只能落在一个视图：按状态唯一映射；未识别的历史状态归入「待处理」。 */
const SUBMISSION_VIEW_BY_STATUS = { 待审核: 'active', 需修改: 'revision', 已通过: 'approved', 已拒绝: 'rejected' };
function submissionViewOf(row) {
  return SUBMISSION_VIEW_BY_STATUS[String(row?.status || '')] || 'active';
}

function openMemberDrawer(ref, { onDone } = {}) {
  const slot = h('div', { class: 'stack-4' }, h('p', { class: 't-caption', text: '正在加载成员资料…' }));
  const reasonField = field({ label: '拉黑原因（需要拉黑时填写）', name: 'memberBlacklistReason', multiline: true, rows: 2, maxlength: 500, placeholder: '例如：多次发布不当内容或骚扰他人。' });
  const blacklistButton = button({ label: '拉黑并踢出', variant: 'danger', iconName: 'shield', onClick: () => blacklist() });
  const drawer = openDrawer({
    placement: 'center',
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
    placement: 'center',
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
    placement: 'center',
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
    placement: 'center',
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
      onDone?.({ decision, id: submission.id });
      // 审核完不必退回主界面：还有待处理稿件就给「下一条」，没有就结束本次流程
      let nextSubmission = null;
      try {
        const list = await consoleApi.community.submissions();
        nextSubmission = (list.submissions || []).find((row) => row.status === '待审核' && row.id !== submission.id) || null;
      } catch { nextSubmission = null; }
      const doneLabel = decision === 'approve' ? '已通过审核' : decision === 'reject' ? '已直接拒绝' : '已退回修改';
      drawer.setBody(
        notice(`${doneLabel}：投稿 ${submission.id}。${nextSubmission ? '还有待处理的稿件，可以直接继续审核。' : '没有其他待处理的稿件了，本次审核流程结束。'}`, { tone: 'success', title: '审核完成' }),
      );
      drawer.setFooter(
        nextSubmission
          ? [h('span', { class: 'spacer' }), button({ label: '下一条', variant: 'primary', iconName: 'arrowRight', onClick: () => { drawer.close(); openSubmissionReviewDrawer(nextSubmission, { onDone }); } })]
          : [h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() })],
      );
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
 * 生日祝福 = 月/日 + 校区（加入即生效）；早安晚安当前仅保留入口，点击显示开发中提示。
 */
function openJoinDrawer({ onDone }) {
  let program = 'birthday';
  let frequency = 'weekly';

  const programControl = segmented({
    items: [
      { value: 'birthday', label: '生日祝福' },
      { value: 'morning', label: '早安晚安（开发中）' },
    ],
    value: program,
    ariaLabel: '项目',
    role: 'radiogroup',
    onChange: (value) => {
      if (value === 'morning') {
        openComingSoon({ title: '早安晚安', description: '该功能正在开发中，敬请期待' });
        programControl.setValue('birthday');
        return;
      }
      program = value;
      programControl.setValue(value);
      sync();
    },
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
    description: '生日祝福加入后即时生效；早安晚安正在开发中。',
  });

  const submitButton = button({ label: '记录参加意愿', variant: 'primary', iconName: 'check', onClick: () => submit() });

  const drawer = openDrawer({
    placement: 'center',
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

  // 「参与人员」：与投稿审核、举报处理共用「指标 + 分段视图 + 表格」结构。
  let interestsView = 'normal';

  const interestsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '参与人员无法加载',
    load: () => Promise.all([consoleApi.community.interests(), consoleApi.community.warmthBlacklist()]).then(([interests, blacklist]) => ({ interests, blacklist })),
    render: ({ interests: payload, blacklist: blacklistPayload }, { reload }) => {
      const reloadAll = () => { reload(); shell.refreshTodos(); };
      const all = payload.interests || [];
      const blacklistEntries = blacklistPayload?.entries || [];
      const entryByRecordId = new Map(blacklistEntries.map((entry) => [String(entry.id || ''), entry]));
      const displayStatusOf = (row) => String(row.displayStatus || row.status || '');
      const normalRows = all.filter((row) => displayStatusOf(row) === '正常');
      const withdrawnRows = all.filter((row) => displayStatusOf(row) === '已退出');
      const blacklistRows = all
        .filter((row) => displayStatusOf(row) === '已拉黑')
        .map((row) => {
          const entry = entryByRecordId.get(String(row.blacklistId || '')) || null;
          return {
            ...row,
            reason: entry?.reason || '已踢出计划；暂无拉黑原因记录',
            handledBy: entry?.handledBy || row.handledBy || '',
            createdAt: entry?.createdAt || row.handledAt || row.submittedAt,
            blacklistRecordId: String(row.blacklistId || ''),
            kickedOnly: !row.blacklistId,
          };
        });
      const buckets = { normal: normalRows, withdrawn: withdrawnRows, blacklist: blacklistRows };
      const isBlacklistView = interestsView === 'blacklist';
      const isWithdrawnView = interestsView === 'withdrawn';
      const rows = buckets[interestsView] || normalRows;
      const viewControl = segmented({
        items: [
          { value: 'normal', label: `正常成员（${normalRows.length}）` },
          { value: 'withdrawn', label: `已退出（${withdrawnRows.length}）` },
          { value: 'blacklist', label: `黑名单（${blacklistRows.length}）` },
        ],
        value: interestsView,
        ariaLabel: '参与人员视图',
        role: 'radiogroup',
        onChange: (value) => {
          interestsView = value;
          reload();
        },
      });
      const memberColumns = [
        { key: 'realName', label: '姓名 / 昵称', strong: true, render: (row) => h('span', { text: row.realName || row.nickname || '—' }) },
        { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
        { key: 'program', label: '项目', render: (row) => badge(PROGRAM_LABEL[row.program] || row.program, { tone: 'accent' }) },
        { key: 'department', label: '院系 / 年级', render: (row) => h('span', { class: 't-caption', text: [row.department, row.grade].filter(Boolean).join(' · ') || '—' }) },
        { key: 'campus', label: '校区', render: (row) => h('span', { class: 't-caption', text: fmt.text(row.campus) }) },
        { key: 'contactEmail', label: '联系邮箱', render: (row) => h('span', { class: 't-caption', text: row.contactEmail || '—' }) },
        { key: 'status', label: '状态', sortable: false, render: (row) => statusFor(displayStatusOf(row)) },
        { key: 'submittedAt', label: '登记时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.submittedAt) }) },
      ];
      const blacklistColumns = [
        { key: 'realName', label: '姓名', strong: true, render: (row) => h('span', { text: row.realName || row.nickname || '—' }) },
        { key: 'studentId', label: '学号', render: (row) => h('span', { class: 't-data', text: row.studentId || '—' }) },
        { key: 'reason', label: '拉黑原因', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.reason || '—' }) },
        { key: 'handledBy', label: '操作人', render: (row) => h('span', { class: 't-caption', text: row.handledBy || '—' }) },
        { key: 'createdAt', label: '拉黑时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.createdAt) }) },
      ];
      return [
        metricRow(
          [
            metric({ label: '登记总数', value: all.length, unit: '人', animate: false }),
            metric({ label: '正常', value: normalRows.length, unit: '人', animate: false }),
            metric({ label: '已退出', value: withdrawnRows.length, unit: '人', animate: false }),
            metric({ label: '黑名单人数', value: blacklistRows.length, unit: '人', tone: blacklistRows.length ? 'warn' : '', animate: false }),
          ],
          { columns: 4 },
        ),
        dataTable({
          columns: isBlacklistView ? blacklistColumns : memberColumns,
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: isBlacklistView ? '搜索姓名、学号或原因' : '搜索姓名、学号、项目或邮箱',
          actions: [viewControl],
          countLabel: (n) => `${n} ${isBlacklistView ? '条黑名单记录' : isWithdrawnView ? '位已退出成员' : '位正常成员'}`,
          empty: isBlacklistView
            ? emptyState({ iconName: 'shield', title: '黑名单为空', description: '在上方「正常成员」里拉黑成员后，记录会出现在这里；可随时解除。' })
            : isWithdrawnView
              ? emptyState({ iconName: 'arrowRight', title: '没有已退出成员', description: '成员在公众端退出后，会保留登记记录并出现在这里。' })
              : emptyState({
                  iconName: 'handshake',
                  title: '还没有正常成员',
                  description: '同学在公众端「温暖连接」页面自愿加入后即登记在这里，加入当天生效；平台不会代替任何人加入。',
                  actions: [button({ label: '查看公众端页面', variant: 'secondary', iconAfter: 'external', href: '/warmth', data: { native: 'true' } })],
                }),
          onRowClick: (row) => isBlacklistView
            ? openMemberDrawer(row.studentId, { onDone: reloadAll })
            : openInterestDrawer(row, { onDone: reloadAll }),
          buildRowAction: (row) => {
            if (isBlacklistView) {
              return button({
                label: '解除拉黑',
                variant: 'secondary',
                size: 'sm',
                iconName: 'refresh',
                disabled: !row.blacklistRecordId && !row.studentId,
                onClick: async () => {
                  const label = row.studentId || '该成员';
                  const confirmed = await confirmAction({
                    title: '解除拉黑？',
                    description: row.kickedOnly
                      ? `${label} 当前为已踢出状态；解除后将恢复为已确认并重新加入生日祝福计划。`
                      : `${label} 将可以重新加入生日祝福计划。`,
                    confirmLabel: '解除拉黑',
                  });
                  if (!confirmed) return;
                  try {
                    if (row.blacklistRecordId) await consoleApi.community.releaseBlacklist(row.blacklistRecordId);
                    else await consoleApi.community.releaseBlacklistByRef({ studentId: row.studentId });
                    notify.success('已解除拉黑', row.studentId || '');
                    reloadAll();
                  } catch (error) {
                    reportError(error, '操作未完成');
                  }
                },
              });
            }
            return button({
              label: '拉黑',
              variant: 'danger',
              size: 'sm',
              iconName: 'shield',
              onClick: () => openBlacklistDrawer(row, { onDone: reloadAll }),
            });
          },
        }),
        notice(
          isBlacklistView
            ? '黑名单包含已拉黑和直接踢出的成员；解除后会恢复为已确认。'
            : isWithdrawnView
              ? '已退出成员仍保留登记记录，可重新加入或由管理员拉黑。'
              : '审核端可查看成员的完整联系信息；内容真实发送前仍需管理员逐批确认。',
          { tone: 'neutral', iconName: isBlacklistView ? 'shield' : 'lock' },
        ),
      ];
    },
  });

  // 投稿池视图：待处理（默认）/ 已通过 / 已拒绝；后两者默认隐藏，从按钮进入
  let submissionsView = 'active';

  const submissionsRegion = asyncRegion({
    lazy: true,
    skeleton: skeletonRows(6),
    errorTitle: '投稿池无法加载',
    load: () => consoleApi.community.submissions(),
    render: (payload, { reload }) => {
      const all = payload.submissions || [];
      // 每份稿件按状态唯一归入一个分类（互斥且穷尽），从结构上保证不会同时出现在两个分类里
      const buckets = { active: [], revision: [], approved: [], rejected: [] };
      for (const row of all) buckets[submissionViewOf(row)].push(row);
      const rows = buckets[submissionsView].slice().sort((a, b) => submissionReviewRank(a.status) - submissionReviewRank(b.status));
      const viewControl = segmented({
        items: [
          { value: 'active', label: `待处理（${buckets.active.length}）` },
          { value: 'revision', label: `待修改（${buckets.revision.length}）` },
          { value: 'approved', label: `已通过（${buckets.approved.length}）` },
          { value: 'rejected', label: `已拒绝（${buckets.rejected.length}）` },
        ],
        value: submissionsView,
        ariaLabel: '投稿视图',
        role: 'radiogroup',
        onChange: (value) => { submissionsView = value; reload(); },
      });
      const viewLabel = submissionsView === 'revision' ? '待修改' : submissionsView === 'approved' ? '已通过' : submissionsView === 'rejected' ? '已拒绝' : '待处理';
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
            metric({ label: '需修改', value: payload.stats.returned, unit: '条', tone: payload.stats.returned ? 'warn' : '', animate: false }),
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
          actions: [viewControl],
          countLabel: (n) => `${n} 条${viewLabel}`,
          empty: emptyState({
            iconName: 'inbox',
            title: submissionsView === 'active' ? '没有待处理的投稿' : submissionsView === 'revision' ? '没有待修改的投稿' : submissionsView === 'approved' ? '还没有已通过的投稿' : '还没有已拒绝的投稿',
            description: submissionsView === 'active'
              ? `待修改 ${buckets.revision.length} 条、已通过 ${buckets.approved.length} 条、已拒绝 ${buckets.rejected.length} 条，可用上方按钮切换查看。`
              : '可用上方按钮切换查看其它分组。',
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

  // 祝福库视图：按后端分类展示「祝福仓库 / 一对一随机 / 一对一已发过的 / 已下线的」。
  let libraryView = 'repository';

  const libraryRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '祝福库无法加载',
    load: () => consoleApi.community.blessingLibrary(),
    render: (payload, { reload }) => {
      const all = payload.items || [];
      const buckets = {
        repository: all.filter((item) => item.category === '祝福仓库'),
        random: all.filter((item) => item.category === '一对一随机'),
        sent: all.filter((item) => item.category === '一对一已发过的'),
        offline: all.filter((item) => item.category === '已下线的'),
      };
      const rows = buckets[libraryView] || buckets.repository;
      const viewLabels = { repository: '祝福仓库', random: '一对一随机', sent: '一对一已发过的', offline: '已下线记录' };
      const viewLabel = viewLabels[libraryView] || viewLabels.repository;
      const viewControl = segmented({
        items: [
          { value: 'repository', label: `祝福仓库（${buckets.repository.length}）` },
          { value: 'random', label: `一对一随机（${buckets.random.length}）` },
          { value: 'sent', label: `一对一已发过的（${buckets.sent.length}）` },
          { value: 'offline', label: `已下线的（${buckets.offline.length}）` },
        ],
        value: libraryView,
        ariaLabel: '祝福库分类',
        role: 'radiogroup',
        onChange: (value) => {
          libraryView = value;
          reload();
        },
      });
      if (!all.length) {
        return emptyState({
          iconName: 'archive',
          title: '祝福库还是空的',
          description: '投稿审核通过后会自动入库，并按投递状态进入对应分类。',
        });
      }
      return [
        metricRow(
          [
            metric({ label: '祝福库总数', value: all.length, unit: '条', animate: false }),
            metric({ label: '祝福仓库', value: buckets.repository.length, unit: '条', animate: false }),
            metric({ label: '一对一随机', value: buckets.random.length, unit: '条', animate: false }),
            metric({ label: '一对一已发过的', value: buckets.sent.length, unit: '条', animate: false }),
            metric({ label: '已下线的', value: buckets.offline.length, unit: '条', tone: buckets.offline.length ? 'warn' : '', animate: false }),
          ],
          { columns: 5 },
        ),
        dataTable({
          columns: [
            { key: 'submissionId', label: '投稿编号', mono: true, render: (row) => h('code', { class: 't-data', text: row.submissionId }) },
            { key: 'category', label: '分类', render: (row) => badge(row.category, { tone: row.category === '已下线的' ? 'neutral' : 'accent' }) },
            { key: 'content', label: '内容', strong: true, render: (row) => h('span', { class: 't-secondary t-clamp-2', text: row.content }) },
            { key: 'nickname', label: '署名昵称', render: (row) => h('span', { class: 't-caption', text: row.nickname || '—' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => badge(row.status, { tone: row.status === '在库' ? 'success' : 'neutral', iconName: row.status === '在库' ? 'check' : null }) },
            { key: 'storedAt', label: '入库时间', render: (row) => h('span', { class: 't-caption', text: fmt.relative(row.storedAt) }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索内容、署名昵称或投稿编号',
          actions: [viewControl],
          countLabel: (n) => `${n} 条${viewLabel}`,
          empty: emptyState({
            iconName: 'archive',
            title: `还没有${viewLabel}`,
            description: '可用上方分类切换查看其它记录。',
          }),
        }),
        notice('祝福仓库可重复参与投递；一对一随机首次送出后会进入「一对一已发过的」，已撤下和作者删除统一进入「已下线的」。', { tone: 'neutral', iconName: 'archive' }),
      ];
    },
  });

  // 举报处理视图：未处理（默认）/ 已处理（含已驳回）
  let reportsView = 'pending';

  const reportsRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(4), skeletonRows(6)),
    errorTitle: '举报无法加载',
    load: () => consoleApi.community.warmthReports(),
    render: (payload, { reload }) => {
      const all = payload.reports || [];
      const pendingRows = all.filter((row) => row.status === '待处理');
      const handledRows = all.filter((row) => row.status !== '待处理');
      if (!all.length) {
        return emptyState({ iconName: 'alert', title: '还没有举报', description: '成员在收到的祝福详情里举报后，会出现在这里等待处理。' });
      }
      const rows = reportsView === 'handled' ? handledRows : pendingRows;
      const viewControl = segmented({
        items: [
          { value: 'pending', label: `未处理（${pendingRows.length}）` },
          { value: 'handled', label: `已处理（${handledRows.length}）` },
        ],
        value: reportsView,
        ariaLabel: '举报视图',
        role: 'radiogroup',
        onChange: (value) => { reportsView = value; reload(); },
      });
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
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索举报理由或编号',
          actions: [viewControl],
          countLabel: (n) => `${n} 条${reportsView === 'handled' ? '已处理' : '未处理'}举报`,
          empty: emptyState({
            iconName: 'alert',
            title: reportsView === 'handled' ? '还没有已处理的举报' : '没有未处理的举报',
            description: reportsView === 'handled' ? '受理或驳回举报后，记录会出现在这里。' : '所有举报都已处理完毕。',
          }),
          onRowClick: (row) => openReportDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }),
          // 操作列直接显示动作按钮（待处理=处理，其余=查看）
          buildRowAction: (row) => button({
            label: row.status === '待处理' ? '处理' : '查看',
            variant: row.status === '待处理' ? 'primary' : 'secondary',
            size: 'sm',
            iconName: row.status === '待处理' ? 'shield' : 'eye',
            onClick: () => openReportDrawer(row, { onDone: () => { reload(); shell.refreshTodos(); } }),
          }),
        }),
        notice('受理成立会把该条祝福从祝福库撤下（不再参与匹配或投递）。', { tone: 'neutral', iconName: 'shield' }),
      ];
    },
  });


  const matchingRegion = asyncRegion({
    lazy: true,
    skeleton: h('div', { class: 'stack-6' }, skeletonMetrics(5), skeletonRows(6)),
    errorTitle: '匹配预览无法加载',
    load: () => consoleApi.community.matchingPreview(),
    render: (payload) => {
      const stats = payload.stats || {};
      const rows = payload.previewRows || [];
      const statusTone = (status) => status === '可预览' ? 'success' : status === '资源不足' || status === '待补充' ? 'warning' : 'neutral';
      return [
        notice(payload.message, { tone: 'warning', iconName: 'alert', title: '预览模式：不创建关系、不发送消息' }),
        metricRow(
          [
            metric({ label: '候选人数', value: stats.candidates || payload.candidateCount || 0, unit: '人', animate: false }),
            metric({ label: '预计投递', value: stats.projectedDeliveries || 0, unit: '条', animate: false }),
            metric({ label: '随机匹配', value: stats.randomMatched || 0, unit: '条', animate: false }),
            metric({ label: '仓库兜底', value: stats.repositoryFallback || 0, unit: '条', animate: false }),
            metric({ label: '预计缺口', value: stats.shortfall || 0, unit: '条', tone: stats.shortfall ? 'warn' : '', animate: false }),
          ],
          { columns: 5 },
        ),
        dataTable({
          columns: [
            { key: 'displayName', label: '候选成员', strong: true },
            { key: 'campus', label: '校区', render: (row) => h('span', { class: 't-caption', text: row.campus || '—' }) },
            { key: 'birthday', label: '生日', render: (row) => h('span', { class: 't-data', text: row.birthday || '—' }) },
            { key: 'written', label: '已通过投稿', render: (row) => h('span', { class: 't-data', text: `${row.written} 条` }) },
            { key: 'projected', label: '预计接收', render: (row) => h('span', { class: 't-data', text: `${row.projected} 条` }) },
            { key: 'source', label: '预计来源', render: (row) => h('span', { class: 't-secondary', text: row.source || '—' }) },
            { key: 'status', label: '状态', sortable: false, render: (row) => badge(row.status, { tone: statusTone(row.status) }) },
          ],
          rows,
          getKey: (row) => row.id,
          searchPlaceholder: '搜索候选成员、校区或状态',
          countLabel: (n) => `${n} 位候选成员`,
          empty: emptyState({ iconName: 'users', title: '暂无候选成员', description: '需要有人自愿加入并保持已确认状态，预览才会出现。' }),
        }),
        h(
          'div',
          { class: 'wscols' },
          region({
            label: '候选统计',
            title: `共 ${stats.candidates || payload.candidateCount || 0} 位候选参与者`,
            description: '按项目拆分候选人数；预计投递不改变真实配对关系。',
            dense: true,
            body: h(
              'div',
              { class: 'stack-4' },
              ...payload.byProgram.map((entry) =>
                h(
                  'div',
                  { class: 'stack-2' },
                  h('div', { class: 'row-between' }, h('span', { class: 't-secondary t-strong', text: PROGRAM_LABEL[entry.program] || entry.program }), h('span', { class: 't-data', text: `${entry.eligible} 人` })),
                  h('p', { class: 't-caption', text: `按周期接收 ${entry.weekly} 人 · 预计投递 ${entry.projected} 条 · ${entry.status}` }),
                ),
              ),
            ),
          }),
          region({
            label: '资源池',
            title: '可用祝福与缺口',
            description: '预览会按已通过投稿额度和可用池计算，不写入投递记录。',
            dense: true,
            body: definitionList([
              ['随机池可用', `${stats.randomPool || 0} 条`],
              ['祝福仓库可用', `${stats.repositoryPool || 0} 条`],
              ['一对一已发过', `${stats.sentPool || 0} 条`],
              ['已下线', `${stats.offlinePool || 0} 条`],
              ['已通过额度', `${stats.writtenQuota || 0} 条`],
              ['缺少生日', `${stats.missingBirthday || 0} 人`],
            ]),
          }),
        ),
        h(
          'div',
          { class: 'wscols' },
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
              ['最终配对', `${(payload.pairs || []).length} 组（预览不创建）`],
              ['人工确认', payload.requiresManualApproval ? '必需' : '不需要'],
            ]),
          }),
        ),
      ];
    },
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
    let editAction = report.status === '已处理' ? 'handle' : 'dismiss';
    const noteField = field({
      label: '处理意见',
      name: 'reportNote',
      value: report.resolutionNote || '',
      multiline: true,
      rows: 3,
      maxlength: 500,
      placeholder: '受理时必须说明处理方式，例如：已核实并撤下该祝福。',
    });
    const statusControl = segmented({
      items: [
        { value: 'handle', label: '受理并撤下' },
        { value: 'dismiss', label: '驳回举报' },
      ],
      value: editAction,
      ariaLabel: '处理结果',
      role: 'radiogroup',
      onChange: (value) => {
        editAction = value;
        statusControl.setValue(value);
        noteField.setError(null);
      },
    });
    const handleButton = button({ label: '受理并撤下', variant: 'danger', iconName: 'alert', onClick: () => submit('handle') });
    const dismissButton = button({ label: '驳回举报', variant: 'secondary', iconName: 'close', onClick: () => submit('dismiss') });
    const drawer = openDrawer({
      placement: 'center',
      eyebrow: '生日祝福 · 举报处理',
      title: `举报 ${report.id}`,
      description: `投稿 ${report.submissionId} · ${fmt.relative(report.submittedAt)}`,
      width: 480,
      body: [h('div')],
      footer: [h('span', { class: 'spacer' })],
    });

    function reportInfo() {
      return [
        h('div', { class: 'row-3 row-wrap' }, statusFor(report.status), button({ label: `举报人 ${report.reporterStudentId || '—'}`, variant: 'ghost', size: 'sm', iconName: 'user', onClick: () => { drawer.close(); openMemberDrawer(report.reporterStudentId, { onDone }); } })),
        h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '被举报祝福' }), h('div', { class: 'content-preview t-secondary', text: report.content || '（原文不可用）' }), h('p', { class: 't-caption t-muted', text: [report.nickname ? `署名：${report.nickname}` : '', report.category ? `分类：${report.category}` : '', report.author ? `投稿人：${report.author}` : ''].filter(Boolean).join(' · ') })),
        h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '举报理由' }), h('div', { class: 'content-preview t-secondary', text: report.reason })),
        report.authorReportCount >= 2 ? notice(`该作者已被举报 ${report.authorReportCount} 次，建议核实后拉黑（拉黑会一并踢出计划并邮件告知本人）。`, { tone: 'warning', title: '多次被举报' }) : null,
      ].filter(Boolean);
    }

    function authorActions() {
      return [
        report.authorRef ? button({ label: '被举报人资料', variant: 'primary', size: 'sm', iconName: 'user', onClick: () => { drawer.close(); openMemberDrawer(report.authorRef, { onDone }); } }) : null,
        report.authorReportCount >= 2 && report.authorRef ? button({ label: '拉黑该作者', variant: 'danger', size: 'sm', iconName: 'shield', onClick: () => blacklistAuthor(report, { onDone }) }) : null,
      ].filter(Boolean);
    }

    function showPending() {
      drawer.setBody(
        ...reportInfo(),
        noteField,
        notice('受理成立会把该条祝福从祝福库撤下（不再参与匹配或投递）。', { tone: 'warning' }),
      );
      drawer.setFooter([
        ...authorActions(),
        h('span', { class: 'spacer' }),
        dismissButton,
        handleButton,
      ].filter(Boolean));
    }

    function showProcessed() {
      drawer.setBody(
        ...reportInfo(),
        h('div', { class: 'stack-2' },
          h('p', { class: 't-label', text: '处理状态' }),
          h('div', { class: 'row-3 row-wrap' },
            statusFor(report.status),
            report.handledBy ? badge(`处理人：${report.handledBy}`, { tone: 'neutral' }) : null,
            report.handledAt ? badge(`处理时间：${fmt.fullDateTime(report.handledAt)}`, { tone: 'neutral' }) : null,
          ),
        ),
        h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '处理意见' }), h('div', { class: 'content-preview t-secondary', text: report.resolutionNote || '—' })),
        notice(report.acknowledgedAt ? `举报人已于 ${fmt.fullDateTime(report.acknowledgedAt)} 确认。` : '举报人尚未确认本次处理结果。', { tone: report.acknowledgedAt ? 'success' : 'neutral', title: '举报人确认' }),
      );
      drawer.setFooter([
        ...authorActions(),
        h('span', { class: 'spacer' }),
        button({ label: '关闭', variant: 'ghost', onClick: () => drawer.close() }),
        button({ label: '编辑处理', variant: 'primary', iconName: 'edit', onClick: showEdit }),
      ].filter(Boolean));
    }

    function showEdit() {
      editAction = report.status === '已处理' ? 'handle' : 'dismiss';
      noteField.control.value = report.resolutionNote || '';
      noteField.setError(null);
      const saveButton = button({ label: '保存修改', variant: 'primary', iconName: 'check', onClick: () => submitEdit(saveButton) });
      drawer.setBody(
        ...reportInfo(),
        h('div', { class: 'stack-2' }, h('p', { class: 't-label', text: '处理结果' }), statusControl),
        noteField,
        notice('修改处理结果会同步更新举报人可见的结论；受理会撤下祝福，改为驳回会恢复仍在库中的祝福。', { tone: 'warning' }),
      );
      statusControl.setValue(editAction);
      drawer.setFooter([
        ...authorActions(),
        h('span', { class: 'spacer' }),
        button({ label: '取消', variant: 'ghost', onClick: showProcessed }),
        saveButton,
      ].filter(Boolean));
    }

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
        onDone?.();
        let nextReport = null;
        try {
          const list = await consoleApi.community.warmthReports();
          nextReport = (list.reports || []).find((row) => row.status === '待处理' && row.id !== report.id) || null;
        } catch { nextReport = null; }
        drawer.setBody(
          notice(`${action === 'handle' ? '已受理并撤下该祝福' : '已驳回该举报'}：举报 ${report.id}。${nextReport ? '还有待处理的举报，可以直接继续。' : '没有其他待处理的举报了，本次处理流程结束。'}`, { tone: 'success', title: '处理完成' }),
        );
        drawer.setFooter(
          nextReport
            ? [h('span', { class: 'spacer' }), button({ label: '下一条', variant: 'primary', iconName: 'arrowRight', onClick: () => { drawer.close(); openReportDrawer(nextReport, { onDone }); } })]
            : [h('span', { class: 'spacer' }), button({ label: '完成', variant: 'primary', onClick: () => drawer.close() })],
        );
      } catch (error) {
        reportError(error, '处理未完成');
      }
    }

    async function submitEdit(saveButton) {
      noteField.setError(null);
      const note = noteField.control.value.trim();
      if (!note) { noteField.setError('请填写处理意见'); shake(noteField); return; }
      try {
        const result = await runWithLoading(saveButton, () => consoleApi.community.decideWarmthReport(report.id, editAction, { note }));
        report.status = result?.report?.status || (editAction === 'handle' ? '已处理' : '已驳回');
        report.resolutionNote = result?.report?.resolutionNote ?? note;
        report.handledBy = result?.report?.handledBy || report.handledBy;
        report.handledAt = result?.report?.handledAt || new Date().toISOString();
        report.acknowledgedAt = null;
        onDone?.();
        notify.success('举报处理已更新', '举报人重新确认前，该结果会继续显示在置顶提醒中。');
        showProcessed();
      } catch (error) {
        reportError(error, '处理未完成');
      }
    }

    if (report.status === '待处理') showPending();
    else showProcessed();
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
