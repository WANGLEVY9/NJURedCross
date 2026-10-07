/* ==========================================================================
   portal/pages/me.js
   The student personal centre. Everything shown here is scoped by the server to
   the signed-in account — the page never sends an identifier of its own, so it
   cannot be talked into showing somebody else's records.
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { request, portal, publicApi, getSessionState, logout, ApiError, getAccountProfile, updateAccountProfile } from '../../core/api.js';
import { confirmAction, openModal, openDrawer } from '../../ui/overlay.js';
import { openBlessingDrawer } from '../blessing-drawer.js';
import { renderBlessingLetter, openBlessingLetterModal, openBlessingReportDialog } from '../blessing-letter.js';
import { BIRTHDAY_CAMPUS_OPTIONS, BIRTHDAY_MONTH_OPTIONS, birthdayDayOptions } from '../warmth-options.js';
import { asyncRegion } from '../../console/lib.js';
import { navigate, redirect, patchQuery } from '../../core/router.js';
import { button, field, badge, statusIndicator, emptyState, errorState, definitionList, notice, queueRow, skeletonBlock, runWithLoading } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const PROGRAM_LABELS = { birthday: '生日祝福', morning: '早安晚安同行' };
const DELIVERED_SOURCE_LABELS = { 指定: '有同学指定送给你', 一对一匹配: '随机匹配送给你', 仓库抽取: '来自祝福仓库' };

/** Registration, submission and enrollment statuses share one palette. */
function toneFor(status) {
  if (['已确认', '已通过', '已签到'].includes(status)) return 'success';
  if (['已取消', '需修改', '已退出', '已拒绝'].includes(status)) return 'error';
  return 'warning';
}

/** Queue rails reuse the same three tones, since the semantics are identical. */
function priorityFor(status) {
  const tone = toneFor(status);
  if (tone === 'success') return 'low';
  if (tone === 'error') return 'high';
  return 'medium';
}

function openInterestEditDrawer(item, { onDone } = {}) {
  const [month = '01', day = '01'] = String(item.birthdayMonthDay || '01-01').split('-');
  const monthField = field({ label: '生日（月）', name: 'birthdayMonth', required: true, options: BIRTHDAY_MONTH_OPTIONS, value: month });
  const dayField = field({ label: '生日（日）', name: 'birthdayDay', required: true, options: birthdayDayOptions(month), value: day });
  monthField.control.addEventListener('change', () => {
    const previous = dayField.control.value;
    dayField.control.replaceChildren(...birthdayDayOptions(monthField.control.value).map((option) => h('option', { value: option.value, text: option.label })));
    if (Number(previous) <= dayField.control.options.length) dayField.control.value = previous;
  });
  const campusField = field({ label: '校区', name: 'campus', required: true, options: [{ value: '', label: '请选择校区' }, ...BIRTHDAY_CAMPUS_OPTIONS.map((campus) => ({ value: campus, label: campus }))], value: item.campus || '' });
  const submitButton = button({ label: '保存修改', variant: 'primary', iconName: 'check', onClick: () => submit() });
  const drawer = openDrawer({
    eyebrow: '生日祝福',
    title: '修改生日资料',
    description: '修改后仍保持当前报名状态，不会产生重复报名。',
    width: 480,
    body: [h('div', { class: 'formgrid' }, monthField, dayField), campusField],
    footer: [h('span', { class: 'spacer' }), button({ label: '取消', variant: 'ghost', onClick: () => drawer.close() }), submitButton],
  });
  async function submit() {
    campusField.setError(null);
    if (!campusField.control.value) { campusField.setError('请选择校区'); campusField.control.focus(); return; }
    const birthdayMonthDay = `${monthField.control.value}-${dayField.control.value}`;
    try {
      const payload = await runWithLoading(submitButton, () => publicApi.updateWarmthInterest(item.id, { birthdayMonthDay, campus: campusField.control.value }));
      notify.success('已更新生日资料', payload.message);
      drawer.close();
      onDone?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) { campusField.setError(error.message); return; }
      reportError(error, '修改失败');
    }
  }
}

function recordRow({ type, title, status, detail, href, action = null, onClick = null }) {
  return queueRow({
    type,
    title,
    detail: detail || '',
    priority: priorityFor(status),
    meta: [statusIndicator(status || '未知', { tone: toneFor(status) })],
    action: action || (href ? button({ label: '查看', variant: 'ghost', size: 'sm', href }) : null),
    onClick,
  });
}

function openBlessingPreview(item, { onChanged } = {}) {
  let modal;
  const actions = [];
  if (item.status === '需修改') {
    actions.push(button({
      label: '修改并重新提交',
      variant: 'primary',
      onClick: () => {
        modal.close();
        openBlessingDrawer({ blessing: item, onDone: onChanged });
      },
    }));
  }
  actions.push(button({ label: '关闭', variant: 'ghost', onClick: () => modal.close() }));
  modal = openModal({
    title: '生日祝福预览',
    width: 680,
    body: [
      renderBlessingLetter({ content: item.content || item.excerpt || '', nickname: item.nickname, submittedAt: item.submittedAt, seal: item.status }),
      definitionList([
        ['状态', item.status],
        ['投递方式', item.delivery || '—'],
        ['目标学号', item.targetStudentId || '（无）'],
        ['提交时间', fmt.fullDateTime(item.submittedAt)],
        item.reviewNote ? ['审核意见', item.reviewNote] : item.previousReviewNote ? ['上一次审核意见', item.previousReviewNote] : null,
      ].filter(Boolean)),
    ],
    footer: [h('span', { class: 'spacer' }), ...actions],
  });
}

function recordPanel(title, description, rows, { emptyTitle, emptyDescription, emptyAction, className = '', id = null } = {}) {
  return h(
    'section',
    { class: ['panel', className].filter(Boolean), id },
    h(
      'header',
      { class: 'panel__head' },
      h('div', { class: 'section-head__text' }, h('h2', { class: 't-h2', text: title }), h('p', { class: 't-caption', text: description })),
      h('span', { class: 'spacer' }),
      badge(`${rows.length} 条`, { tone: rows.length ? 'accent' : 'neutral' }),
    ),
    h(
      'div',
      { class: 'panel__body' },
      rows.length
        ? h('div', { class: 'queue' }, ...rows)
        : emptyState({ iconName: 'inbox', title: emptyTitle, description: emptyDescription, actions: emptyAction ? [emptyAction] : [] }),
    ),
  );
}

export default async function mePage() {
  const slot = h('div', { class: 'stack-5' });
  const profileSlot = h('section', {class:'panel member-anchor', id:'member-profile', 'aria-busy':'true'},
    h('header',{class:'panel__head'},h('h2',{class:'t-h2',text:'我的个人资料'})),
    h('div',{class:'panel__body stack-4'},h('p',{class:'t-caption',role:'status',text:'正在加载个人资料…'}),skeletonBlock('130px'),skeletonBlock('60px'),
      h('div',{class:'formgrid profile-fields','aria-hidden':'true'},...Array.from({length:10},()=>skeletonBlock('82px'))),skeletonBlock('130px')));

  async function signOut() {
    try {
      await logout();
      notify.success('已退出登录', '浏览公开内容不受影响。');
      navigate('/', { replace: true });
    } catch (error) {
      reportError(error, '退出失败');
    }
  }

  async function loadProfile(){
    try{
      const {account,profileMapping={}}=await getAccountProfile();
      const options=profileMapping.options||{};
      const choose=(key,value)=>options[key]?.length?[{value:"",label:"暂不填写"},...new Set([...(value?[value]:[]),...options[key]])]:null;
      const student=account.role==='member';
      const inferredId=/^[0-9]{6,20}$/.test(account.email?.split('@')[0]||'')?account.email.split('@')[0]:'';
      const realName=field({label:'真实姓名',name:'realName',value:account.realName||'',maxlength:40,required:student,disabled:!!account.realName,autocomplete:'name',placeholder:'请填写本人真实姓名'});
      const studentId=field({label:'学号',name:'studentId',value:account.studentId||inferredId,maxlength:20,required:student,disabled:!!account.studentId||!student});
      const phone=field({label:'手机号（选填）',name:'phone',type:'tel',value:account.phone||'',maxlength:21,autocomplete:'tel',placeholder:'仅供必要的活动联系使用'});
      const department=field({label:'院系（选填）',name:'department',value:account.department||'',maxlength:60,options:choose('department',account.department),autocomplete:'organization'});
      const grade=field({label:'年级（选填）',name:'grade',value:account.grade||'',maxlength:20,options:choose('grade',account.grade),placeholder:'例如：2023 级本科'});
      const gender=field({label:'性别（选填）',name:'gender',value:account.gender||'',options:choose('gender',account.gender)});
      const campus=field({label:'校区（选填）',name:'campus',value:account.campus||'',options:choose('campus',account.campus)});
      const contactEmail=field({label:'联系邮箱（选填）',name:'contactEmail',type:'email',value:account.contactEmail||'',maxlength:160,hint:'用于活动联系，不会替换已验证校园邮箱，也不能用于登录或找回密码。'});
      const wechat=field({label:'微信（选填）',name:'wechat',value:account.wechat||'',maxlength:60});
      const qq=field({label:'QQ（选填）',name:'qq',value:account.qq||'',maxlength:20,inputmode:'numeric'});
      const feedback=h('div',{'aria-live':'polite'});let saving=false;
      const save=button({label:'保存个人资料',variant:'primary',onClick:()=>submit()});
      async function submit(){
        if(saving)return;saving=true;save.disabled=true;save.dataset.loading='true';
        try{
          const result=await updateAccountProfile({gender:gender.control.value,campus:campus.control.value,contactEmail:contactEmail.control.value,wechat:wechat.control.value,qq:qq.control.value,realName:realName.control.value,...(student?{studentId:studentId.control.value}:{}),phone:phone.control.value,department:department.control.value,grade:grade.control.value});
          notify.success('资料已保存',result.message);await loadProfile();
        }catch(error){feedback.replaceChildren(notice(error.message||'资料保存失败，请重试。',{tone:'error'}));}
        finally{saving=false;save.disabled=false;delete save.dataset.loading;}
      }
      profileSlot.replaceChildren(h('header',{class:'panel__head'},h('h2',{class:'t-h2',text:'我的个人资料'}),badge(student?'普通用户':account.role==='super_admin'?'超级管理员':'管理员',{tone:'accent'})),h('form',{class:'panel__body stack-4',on:{submit:e=>{e.preventDefault();submit();}}},
        definitionList([['已验证邮箱',account.email||'未设置'],['会员身份码',account.memberCode||'管理账号'],['账号 ID',account.accountId||account.username]]),
        notice(profileMapping.state==='已同步'?'已与志愿服务平台个人主页关联。可在此修改联系资料。':profileMapping.state==='需人工核验'?'志愿资料存在身份冲突或重复记录，请联系管理员核验；不会自动关联他人资料。':profileMapping.state==='待重试'?'志愿资料同步暂未完成。已保存的修改会在下次打开会员中心时重试。':'完成邮箱、学号和姓名核验后，自动关联志愿服务平台个人主页。',{tone:profileMapping.state==='已同步'?'success':'info'}),
        h('div',{class:'formgrid profile-fields'},realName,studentId,phone,department,grade,gender,campus,contactEmail,wechat,qq),
        profileMapping.readonly?.division||profileMapping.readonly?.firstAid||profileMapping.readonly?.totalHours?definitionList([['所属部门',profileMapping.readonly.division||'未登记'],['急救资质',profileMapping.readonly.firstAid||'未登记'],['总志愿时长',profileMapping.readonly.totalHours||'未登记']]):null,
        h('p',{class:'t-caption t-muted',text:'尚未填写的真实姓名可以补填，保存后绑定到当前账号。联系资料可随时补充并同步到志愿服务平台。姓名与学号绑定后如需更正，请联系管理员；部门、急救资质和志愿时长由管理端维护。资料不会在公开页面展示。'}),feedback,save));
    }catch(error){profileSlot.replaceChildren(errorState({title:'个人资料暂不可用',error,onRetry:()=>loadProfile()}));}
    finally{profileSlot.setAttribute('aria-busy','false');}
  }

  function render(payload) {
    const { account, registrations, submissions, enrollments, blessings = [], delivered = [] } = payload;

    clear(slot);
    slot.append(
      recordPanel(
        '我的活动报名',
        '报名、候补与现场签到的当前状态。',
        registrations.map((item) =>
          recordRow({
            type: '活动报名',
            title: item.eventName,
            status: item.cancelledAt ? '已取消' : item.checkedInAt ? '已签到' : item.status,
            detail: [item.code, fmt.fullDateTime(item.startAt), item.location].filter(Boolean).join(' · '),
            href: '/events',
          }),
        ),
        { emptyTitle: '还没有报名记录', emptyDescription: '浏览正在开放的活动，选择场次后即可报名。', emptyAction: button({ label: '浏览活动', variant: 'primary', size: 'sm', iconName: 'calendar', href: '/events' }) },
      ),
      recordPanel(
        '我的内容投稿',
        '投稿进入人工审核队列后的结论。',
        submissions.map((item) =>
          recordRow({
            type: item.category || '内容投稿',
            title: item.title,
            status: item.status,
            detail: [item.id, fmt.fullDateTime(item.submittedAt), item.reviewNote ? `审核意见：${item.reviewNote}` : ''].filter(Boolean).join(' · '),
          }),
        ),
        { emptyTitle: '还没有投稿记录', emptyDescription: '稿件、摄影与设计作品都可以投递，全部经人工审核。', emptyAction: button({ label: '去投稿', variant: 'primary', size: 'sm', iconName: 'megaphone', href: '/submit' }) },
      ),
      recordPanel(
        '我写的生日祝福',
        '点击任意一条可放大预览；这里同时显示审核进度、审核意见与重新提交入口。',
        blessings.map((item) =>
          recordRow({
            type: '生日祝福',
            title: item.excerpt || item.content?.slice(0, 60) || '生日祝福投稿',
            status: item.status,
            detail: [
              `内容：${item.content || item.excerpt || ''}`,
              item.id,
              fmt.fullDateTime(item.submittedAt),
              item.delivery,
              item.reviewNote ? `审核意见：${item.reviewNote}` : item.previousReviewNote ? `上一次审核意见：${item.previousReviewNote}` : '',
              '点击放大预览',
            ].filter(Boolean).join(' · '),
            onClick: () => openBlessingPreview(item, { onChanged: () => load() }),
          }),
        ),
        { id: 'member-warmth-blessings', emptyTitle: '还没有生日祝福投稿', emptyDescription: '加入生日祝福计划后就可以给同学写祝福，审核通过后也会收到一对一的祝福。', emptyAction: button({ label: '去写祝福', variant: 'primary', size: 'sm', href: '/warmth' }), className: 'warmth-member-blessings member-anchor' },
      ),
      recordPanel(
        '我收到的生日祝福',
        '生日当天由平台送达给你的祝福（站内同步展示）。',
        delivered.map((item) =>
          recordRow({
            type: '收到的祝福',
            title: item.content,
            status: '已送达',
            detail: [item.nickname ? `来自：${item.nickname}` : '', DELIVERED_SOURCE_LABELS[item.source] || '', item.deliveredAt ? fmt.fullDateTime(item.deliveredAt) : '', '点击查看详情'].filter(Boolean).join(' · '),
            onClick: () => openBlessingLetterModal({
              title: '收到的生日祝福',
              content: item.content,
              nickname: item.nickname,
              submittedAt: item.deliveredAt,
              seal: '已送达',
              rows: [['来源', DELIVERED_SOURCE_LABELS[item.source] || '—'], ['送达时间', fmt.fullDateTime(item.deliveredAt)]],
              reportable: true,
              reported: item.reported,
              onReport: () => openBlessingReportDialog({ submissionId: item.submissionId, onDone: () => load() }),
            }),
          }),
        ),
        { id: 'member-warmth-delivered', emptyTitle: '还没有收到生日祝福', emptyDescription: '生日当天，指定给你的祝福会通过邮件送达，并同步显示在这里。', className: 'member-anchor' },
      ),
      recordPanel(
        '我的温暖连接登记',
        '参加意愿、接收频率与处理进度。',
        enrollments.map((item) =>
          recordRow({
            type: PROGRAM_LABELS[item.program] || item.program,
            title: item.program === 'birthday' ? `生日祝福${item.campus ? ` · ${item.campus}` : ''}` : item.frequency === 'weekly' ? '每周接收' : '仅接收一次',
            status: item.status,
            detail: [item.id, item.program === 'birthday' && item.birthdayMonthDay ? `生日 ${item.birthdayMonthDay}` : '', fmt.fullDateTime(item.submittedAt)].filter(Boolean).join(' · '),
            action: item.status !== '已退出'
              ? h('div', { class: 'row-2 row-wrap' },
                  item.program === 'birthday'
                    ? button({ label: '修改', variant: 'secondary', size: 'sm', onClick: () => openInterestEditDrawer(item, { onDone: async () => { await load(); scrollToSection('member-warmth-enrollments'); } }) })
                    : null,
                  button({
                    label: '退出',
                    variant: 'danger',
                    size: 'sm',
                    onClick: async () => {
                      const confirmed = await confirmAction({
                        title: `退出「${PROGRAM_LABELS[item.program] || item.program}」？`,
                        description: '退出后不再进入匹配或发送队列；如需重新参加，可以再次提交登记。',
                        confirmLabel: '确认退出',
                        tone: 'danger',
                      });
                      if (!confirmed) return;
                      try {
                        await publicApi.withdrawWarmthInterest(item.id);
                        notify.success('已退出', '之后不会再进入匹配或发送队列。');
                        load();
                      } catch (error) {
                        reportError(error, '退出失败');
                      }
                    },
                  }),
                )
              : null,
          }),
        ),
        { id: 'member-warmth-enrollments', emptyTitle: '还没有登记温暖连接', emptyDescription: '生日祝福与早安晚安同行计划完全自愿，随时可以退出。', emptyAction: button({ label: '了解计划', variant: 'primary', size: 'sm', iconName: 'heart', href: '/warmth' }), className: 'member-anchor' },
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel__body' }, notice('物资借用申请暂时没有和账号绑定：申请表要求填写姓名、学号与邮箱，审批结果按你提交时留下的邮箱通知。要查询某次申请，请使用提交时收到的申请编号。', { tone: 'info', title: '关于物资借用记录' })),
      ),
    );
  }

  /** Scrolls a member-centre anchor into view; used by deep links and post-save returns. */
  function scrollToSection(id) {
    if (!id) return;
    requestAnimationFrame(() => {
      const section = document.getElementById(id);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** Deep link: /me?focus=<section-id> scrolls the matching record panel into view. */
  function focusRequestedSection() {
    const target = new URLSearchParams(location.search).get('focus');
    if (!target) return;
    scrollToSection(target);
    patchQuery({ focus: null });
  }

  async function load() {
    clear(slot);
    slot.append(skeletonBlock('240px'));
    try {
      const payload = await portal.me();
      let blessings = [];
      try {
        const blessingPayload = await publicApi.myWarmthBlessings();
        blessings = blessingPayload.blessings || [];
      } catch {
        blessings = [];
      }
      let delivered = [];
      try {
        const deliveredPayload = await publicApi.deliveredWarmthBlessings();
        delivered = deliveredPayload.blessings || [];
      } catch {
        delivered = [];
      }
      render({ ...payload, blessings, delivered });
      focusRequestedSection();
    } catch (error) {
      if (error instanceof ApiError && error.isAuth) {
        redirect(`/login?next=${encodeURIComponent('/me')}`);
        return;
      }
      clear(slot);
      slot.append(errorState({ title: '个人记录无法加载', error, onRetry: () => load(), onBack: () => navigate('/') }));
    }
  }

  const workflowHours=asyncRegion({
    load:async()=>{try{return await request('/api/portal/workflow/me');}catch(error){if(error.code==='workflow_disabled')return null;throw error;}},
    errorTitle:'活动志愿时长暂时无法加载',
    render:data=>data?h('section',{class:'panel'},h('div',{class:'panel__body stack-4'},h('h2',{class:'t-h3',text:'活动志愿时长'}),data.profile?definitionList([['已入账服务时长',`${data.profile.serviceHours} 小时`],['培训时长',`${data.profile.trainingHours} 小时`],['交通时长',`${data.profile.travelHours} 小时`]]):notice('暂无活动时长记录。',{tone:'neutral'}),button({label:'查看活动与报名状态',href:'/workflow-events',variant:'secondary'}))):null,
  });
  const session = getSessionState();
  const node = h(
    'div',
    { class: 'view' },
    h(
      'section',
      { class: 'formpage' },
      h(
        'div',
        { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回首页' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '会员中心' }), badge(session.user?.username || '已登录', { tone: 'accent', iconName: 'user' })),
        h('h1', { class: 't-h1', text: '会员中心' }),
        h('p', { class: 't-prose', text: '查看个人资料、报名记录和志愿时长。' }),
      ),
      h('nav', { class: 'member-shortcuts', 'aria-label': '会员功能' },
        button({label:'个人资料',href:'#member-profile',variant:'secondary',iconName:'user'}),
        button({label:'参与记录',href:'#member-records',variant:'secondary',iconName:'calendar'}),
        button({label:'编号查询',href:'/status',variant:'secondary',iconName:'search'}),
        button({label:'修改密码',href:'/change-password',variant:'secondary',iconName:'lock'})),
      profileSlot,
      h('section',{id:'member-records',class:'stack-5 member-anchor'},workflowHours,slot),
      h('div',{class:'row-between row-wrap'},button({label:'返回活动广场',href:'/events',variant:'secondary'}),button({label:'退出登录',variant:'ghost',onClick:()=>signOut()})),
    ),
  );

  loadProfile();
  load();
  return { title: '会员中心', node };
}
