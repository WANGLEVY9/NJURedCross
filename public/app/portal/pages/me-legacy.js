import {profileConflictMessage} from '../../shared/profile-completeness.js';
import {certificateSelectOptions,canonicalCertificate} from '../../shared/certificates.js';
import { memberWorkspace, memberHours, memberDepartment } from '../member-workspace.js';
import { memberHero, createWorkflowFeed } from '../member-hero.js';
import { createSkillsSection } from './me-skills.js';
/* ==========================================================================
   portal/pages/me.js
   The student personal centre. Everything shown here is scoped by the server to
   the signed-in account — the page never sends an identifier of its own, so it
   cannot be talked into showing somebody else's records.
   ========================================================================== */

import { h, clear } from '../../core/dom.js';
import { request, portal, morningApi, logout, ApiError, getAccountProfile, updateAccountProfile } from '../../core/api.js';
import { asyncRegion } from '../../console/lib.js';
import { navigate, redirect } from '../../core/router.js';
import { button, field, badge, statusIndicator, emptyState, errorState, definitionList, notice, queueRow, skeletonBlock } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';

const PROGRAM_LABELS = { birthday: '生日祝福', morning: '早安晚安同行' };

/** Registration, submission and enrollment statuses share one palette. */
function toneFor(status) {
  if (['已确认', '已通过', '已签到'].includes(status)) return 'success';
  if (['已取消', '需修改', '已退出'].includes(status)) return 'error';
  return 'warning';
}

/** Queue rails reuse the same three tones, since the semantics are identical. */
function priorityFor(status) {
  const tone = toneFor(status);
  if (tone === 'success') return 'low';
  if (tone === 'error') return 'high';
  return 'medium';
}

function recordRow({ type, title, status, detail, href, action = null }) {
  return queueRow({
    type,
    title,
    detail: detail || '',
    priority: priorityFor(status),
    meta: [statusIndicator(status || '未知', { tone: toneFor(status) })],
    action: action || (href ? button({ label: '查看', variant: 'ghost', size: 'sm', href }) : null),
  });
}

function recordPanel(title, description, rows, { emptyTitle, emptyDescription, emptyAction } = {}) {
  return h(
    'section',
    { class: 'panel' },
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
  const warmthSlot = h('div', { class: 'stack-5' });
  let workspace;
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

  async function loadProfile({fresh=true}={}){
    try{
      const {account,profileMapping={}}=await getAccountProfile({fresh});
      const options=profileMapping.options||{};
      const choose=(key,value)=>options[key]?.length?[{value:"",label:["department","gender"].includes(key)?"请选择":"暂不填写"},...new Set([...(value?[value]:[]),...options[key]])]:null;
      const student=account.role==='member';
      const inferredId=/^[0-9]{6,20}$/.test(account.email?.split('@')[0]||'')?account.email.split('@')[0]:'';
      const realName=field({label:'真实姓名',name:'realName',value:account.realName||'',maxlength:40,required:student,disabled:!!account.realName,autocomplete:'name',placeholder:'请填写本人真实姓名'});
      const studentId=field({label:'学号',name:'studentId',value:account.studentId||inferredId,maxlength:20,required:student,disabled:!!account.studentId||!student});
      const phone=field({label:'手机号',name:'phone',required:true,type:'tel',value:account.phone||'',maxlength:21,autocomplete:'tel',placeholder:'仅供必要的活动联系使用'});
      const department=field({label:'院系',name:'department',required:true,value:account.department||'',maxlength:60,options:choose('department',account.department),autocomplete:'organization'});
      const grade=field({label:'年级（选填）',name:'grade',value:account.grade||'',maxlength:20,options:choose('grade',account.grade),placeholder:'例如：2023 级本科'});
      const gender=field({label:'性别',name:'gender',required:true,value:account.gender||'',options:choose('gender',account.gender)});
      const campus=field({label:'校区',name:'campus',required:true,value:account.campus||'',options:choose('campus',account.campus)});
      const contactEmail=field({label:'联系邮箱（选填）',name:'contactEmail',type:'email',value:account.contactEmail||'',maxlength:160,hint:'用于活动联系，不会替换已验证校园邮箱，也不能用于登录或找回密码。'});
      const notificationEmail=field({label:'收信邮箱（选填）',name:'notificationEmail',type:'email',value:account.notificationEmail||'',maxlength:160,autocomplete:'email',hint:'平台通知邮件将发到此邮箱；留空则使用已验证的校园邮箱。注册、改密验证码仍只发校园邮箱。'});
      const wechat=field({label:'微信',name:'wechat',required:true,value:account.wechat||'',maxlength:60});
      const qq=field({label:'QQ',name:'qq',required:true,value:account.qq||'',maxlength:20,inputmode:'numeric'});
      const certificateValue=account.certificate||profileMapping.readonly?.firstAid||'';
      const certificateOptions=certificateSelectOptions(options.certificate,certificateValue);
      const certificate=field({label:'急救证',name:'certificate',required:true,value:canonicalCertificate(certificateValue)?certificateValue:'',options:[{value:'',label:'请选择急救证情况'},...certificateOptions],hint:'没有证书请选择“否”；保存后同步至志愿服务平台。'});
      const feedback=h('div',{'aria-live':'polite'});let saving=false;
      const save=button({label:'保存个人资料',variant:'primary',onClick:()=>submit()});
      async function submit(){
        if(saving)return;
        if([realName,studentId,phone,department,grade,gender,campus,contactEmail,notificationEmail,wechat,qq,certificate].filter(Boolean).some(item=>!item.control.reportValidity()))return;
        saving=true;save.disabled=true;save.dataset.loading='true';
        try{
          const values={certificate:certificate.control.value,gender:gender.control.value,campus:campus.control.value,contactEmail:contactEmail.control.value,notificationEmail:notificationEmail.control.value.trim(),wechat:wechat.control.value,qq:qq.control.value,realName:realName.control.value,...(student?{studentId:studentId.control.value}:{}),phone:phone.control.value,department:department.control.value,grade:grade.control.value};
          const changes=Object.fromEntries(Object.entries(values).filter(([key,value])=>String(value).trim()!==String((key==='certificate'?certificateValue:account[key])||'').trim()));
          const result=await updateAccountProfile(changes);
          notify.success('资料已保存',result.message);await loadProfile({fresh:false});
        }catch(error){feedback.replaceChildren(notice(error.message||'资料保存失败，请重试。',{tone:'error'}));}
        finally{saving=false;save.disabled=false;delete save.dataset.loading;}
      }
      profileSlot.replaceChildren(h('header',{class:'panel__head'},h('h2',{class:'t-h2',text:'我的个人资料'}),badge(student?'普通用户':account.role==='super_admin'?'超级管理员':'管理员',{tone:'accent'})),h('form',{class:'panel__body stack-4',on:{submit:e=>{e.preventDefault();submit();}}},
        definitionList([['已验证邮箱',account.email||'未设置'],['会员身份码',account.memberCode||'管理账号'],['账号 ID',account.accountId||account.username]]),
        notice(profileMapping.state==='已同步'?'已与志愿服务平台个人主页关联。可在此修改联系资料。':profileMapping.state==='需人工核验'?profileConflictMessage(profileMapping):profileMapping.state==='待重试'?'志愿资料同步暂未完成。已保存的修改会在下次打开会员中心时重试。':'完成邮箱、学号和姓名核验后，自动关联志愿服务平台个人主页。',{tone:profileMapping.state==='已同步'?'success':'info'}),
        h('div',{class:'formgrid profile-fields'},realName,studentId,phone,department,grade,gender,campus,contactEmail,notificationEmail,wechat,qq,certificate),
        profileMapping.readonly?.division||profileMapping.readonly?.totalHours?definitionList([['所属部门',memberDepartment(profileMapping.readonly.division)],['总志愿时长',profileMapping.readonly.totalHours||'未登记']]):null,
        h('p',{class:'t-caption t-muted',text:'尚未填写的真实姓名可以补填，保存后绑定到当前账号。联系资料可随时补充并同步到志愿服务平台；收信邮箱只影响平台通知的投递地址，不会同步到志愿平台，也不用于登录。姓名与学号绑定后如需更正，请联系管理员；部门和志愿时长由管理端维护。资料不会在公开页面展示。'}),feedback,save));
    }catch(error){profileSlot.replaceChildren(errorState({title:'个人资料暂不可用',error,onRetry:()=>loadProfile()}));}
    finally{profileSlot.setAttribute('aria-busy','false');}
  }

  function render(payload) {
    const { account, registrations, submissions, enrollments, morningFavorites = [] } = payload;

    clear(slot);
    const recordNodes = [
      recordPanel(
        '我的活动报名',
        '报名、候补与现场签到的当前状态。',
        registrations.map((item) =>
          recordRow({
            type: '活动报名',
            title: item.eventName,
            status: item.cancelledAt ? '已取消' : item.checkedInAt ? '已签到' : item.status,
            detail: [item.code, fmt.fullDateTime(item.startAt), item.location].filter(Boolean).join(' · '),
            href: item.eventId ? `/events/${encodeURIComponent(item.eventId)}` : '/events',
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
        '我的温暖连接登记',
        '参加意愿、接收频率与处理进度。',
        enrollments.map((item) =>
          recordRow({
            type: PROGRAM_LABELS[item.program] || item.program,
            title: item.frequency === 'weekly' ? '每周接收' : '仅接收一次',
            status: item.status,
            detail: [item.id, fmt.fullDateTime(item.submittedAt)].filter(Boolean).join(' · '),
          }),
        ),
        { emptyTitle: '还没有登记温暖连接', emptyDescription: '生日祝福与早安晚安同行计划完全自愿，随时可以退出。', emptyAction: button({ label: '了解计划', variant: 'primary', size: 'sm', iconName: 'heart', href: '/community' }) },
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'panel__body' }, notice('物资借用申请暂时没有和账号绑定：申请表要求填写姓名、学号与邮箱，审批结果按你提交时留下的邮箱通知。要查询某次申请，请使用提交时收到的申请编号。', { tone: 'info', title: '关于物资借用记录' })),
      ),
    ];
    slot.replaceChildren(recordNodes[0], recordNodes[1], recordNodes[3]);
    warmthSlot.replaceChildren(recordNodes[2], recordPanel(
      '我的名片心愿单',
      '收藏的同行名片会保存在这里，方便随时查看。',
      morningFavorites.map(item => recordRow({
        type: '早安晚安',
        title: item.nickname || '同行名片',
        status: item.campus || '已收藏',
        detail: [item.gender, ...(item.interestTags || [])].filter(Boolean).join(' · '),
        href: `/morning/plaza/${encodeURIComponent(item.id)}`,
        action: h('div', { class: 'row-2 row-wrap' },
          button({ label: '查看', variant: 'ghost', size: 'sm', href: `/morning/plaza/${encodeURIComponent(item.id)}` }),
          button({ label: '移出收藏', variant: 'ghost', size: 'sm', onClick: async () => {
            try {
              await morningApi.removeFavorite(item.id);
              notify.success('已移出心愿单');
              await load();
            } catch (error) {
              reportError(error, '移除收藏失败');
            }
          } })),
      })),
      { emptyTitle: '心愿单还是空的', emptyDescription: '在同行名片详情中点击“加入收藏夹”，喜欢的伙伴就会出现在这里。', emptyAction: button({ label: '浏览同行广场', variant: 'primary', size: 'sm', iconName: 'heart', href: '/morning/plaza' }) },
    ));
  }

  async function load() {
    clear(slot);
    warmthSlot.replaceChildren(skeletonBlock('160px'));
    slot.append(skeletonBlock('240px'));
    try {
      const [payload, favorites] = await Promise.all([
        portal.me(),
        morningApi.favorites().catch(() => ({ favorites: [] })),
      ]);
      render({ ...payload, morningFavorites: favorites.favorites || [] });
    } catch (error) {
      if (error instanceof ApiError && error.isAuth) {
        redirect(`/login?next=${encodeURIComponent('/me')}`);
        return;
      }
      clear(slot);
      slot.append(errorState({ title: '个人记录无法加载', error, onRetry: () => load(), onBack: () => navigate('/') }));
      warmthSlot.replaceChildren(errorState({ title: '温暖连接记录无法加载', error, onRetry: () => load() }));
    }
  }

  const feed=createWorkflowFeed(request);
  const hero=memberHero({feed});
  const workflowHours=asyncRegion({
    load:feed,
    errorTitle:'活动志愿时长暂时无法加载',
    render: memberHours,
  });
  workspace = memberWorkspace({
    profile: profileSlot,
    records: h('section', { id: 'member-records', class: 'stack-5 member-anchor' }, workflowHours, slot),
    warmth: warmthSlot,
    skills: createSkillsSection(),
  });
  const node = h('div', { class: 'view plaza-page member-page' },
    h('div', { class: 'plaza-frame' },
      hero,
      h('div', { class: 'member-toolbar' },
        h('p', { class: 't-caption', text: '在这里查看与你的账号关联的资料和记录。' }),
        h('div', { class: 'row-3 row-wrap' },
          button({ label: '编号查询', href: '/status', variant: 'ghost', iconName: 'search' }),
          button({ label: '修改密码', href: '/change-password', variant: 'ghost', iconName: 'lock' }))),
      workspace.node,
      h('div', { class: 'member-session-actions' },
        h('p', { class: 't-caption', text: '公开页面不会展示你的个人资料。' }),
        button({ label: '退出登录', variant: 'ghost', onClick: () => signOut() }))),
  );

  loadProfile();
  load();
  return { title: '会员中心', node };
}
