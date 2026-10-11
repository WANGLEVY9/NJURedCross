/* ==========================================================================
   portal/pages/task-claim.js
   任务申领（v3 S5 / 第 8 项 + D6）——「心愿清单」页。

   两块内容：
     1. 心愿清单：待认领任务，按「星级要求」降序 + 发布时间升序排列。
        成员可一键认领（写入任务申领表 + 任务表状态）。
     2. 我认领的任务：本人已认领记录，便于回看与跟进。

   发布入口按权限显示：拥有 outreach 控制台权限的账号可直接在页内发布任务
   （发布人自评 1-5 星，D3）。普通成员只能认领。
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, consoleApi, ApiError } from '../../core/api.js';
import { button, field, notice, badge, emptyState, segmented, runWithLoading } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { hasPermission } from '../../core/api.js';

const TASK_TYPES = ['文字撰写', '摄影摄像', '平面设计', '推文排版', '现场执行', '其他'];
const STAR_LEVELS = [
  { level: 1, label: '了解', hint: '能看懂、能跟着做' },
  { level: 2, label: '熟练', hint: '能独立完成常规任务' },
  { level: 3, label: '精通', hint: '能独立完成并处理疑难' },
  { level: 4, label: '能手', hint: '能带人、能定标准' },
  { level: 5, label: '专家', hint: '能独立开设培训' },
];
/** v3.1：任务所需的技能名称（与成员技能认证同一套字典，含「其他」）。 */
const SKILL_NAME_FALLBACK = ['图片处理', '公众号排版', '海报设计', '绘图与二创',
  '板写与 logo 设计', '动画与 live 2D', '3D建模', '其他'];
const SKILL_OTHER = '其他';

function starChip(level) {
  const found = STAR_LEVELS.find((item) => item.level === Number(level));
  return badge(`${level} 星${found ? ` · ${found.label}` : ''}`, {
    tone: level >= 4 ? 'accent' : level >= 3 ? 'info' : 'neutral',
    iconName: 'star',
  });
}

export default async function taskClaimPage() {
  const state = {
    tab: 'wishlist',
    tasks: [],
    claims: [],
    types: TASK_TYPES,
    skillNames: SKILL_NAME_FALLBACK,
    myStars: 0,
    stats: { open: 0, reviewing: 0, claimed: 0 },
    loading: true,
    publishing: false,
  };

  const listSlot = h('div', { class: 'stack-6' });
  const canPublish = isSignedIn() && hasPermission('outreach');

  /* --- 数据 --------------------------------------------------------------- */

  async function load() {
    state.loading = true;
    renderList();
    try {
      const payload = await publicApi.tasks();
      state.tasks = payload.tasks || [];
      state.types = payload.types?.length ? payload.types : TASK_TYPES;
      state.skillNames = payload.skillNames?.length ? payload.skillNames : SKILL_NAME_FALLBACK;
      state.myStars = payload.myStars || 0;
      state.stats = payload.stats || { open: 0, reviewing: 0, claimed: 0 };
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      reportError(error, '心愿清单加载失败');
    } finally {
      state.loading = false;
    }
    try {
      const mine = await publicApi.myClaims();
      state.claims = mine.claims || [];
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      state.claims = [];
    }
    renderList();
  }

  async function claimTask(task, node) {
    if (task.status !== '待认领') {
      notify.info('这个任务已不可认领', `${task.title}：当前状态「${task.status}」。`);
      return;
    }
    const note = window.prompt(`申领任务「${task.title}」\n\n可以留一句话给发布人（可留空）：\n（提交后需管理员审核，通过才正式接单）`, '');
    if (note === null) return;
    try {
      const run = () => publicApi.claimTask(task.id, note.trim());
      const payload = node ? await runWithLoading(node, run) : await run();
      notify.success('已提交申领', payload.message || task.title);
      await load();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError && error.status === 409) {
        notify.info('没抢到', error.message || '这个任务刚被申领。');
        await load();
        return;
      }
      notify.warning('申领未成功', error?.message || '请稍后重试。');
    }
  }

  /* --- 发布（有权限时） --------------------------------------------------- */

  // 使用 field() 生成受控字段，保持与其他表单一致的可访问性与错误提示样式。
  const titleField = field({ label: '任务标题', name: 'task-title', placeholder: '如：秋季急救培训现场摄影', maxlength: 60, required: true, hint: '一句话说清要做什么' });
  const typeField = field({ label: '任务类型', name: 'task-type', options: TASK_TYPES.map((t) => ({ value: t, label: t })) });
  const starsField = field({
    label: '星级要求（发布人自评）', name: 'task-stars',
    options: [{ value: '', label: '（自评星级）' }, ...STAR_LEVELS.map((s) => ({ value: String(s.level), label: `${s.level} 星 · ${s.label}（${s.hint}）` }))],
    hint: '1 星=了解即可，5 星=需要专家级成员',
  });
  /* v3.1：任务发布需附带技能要求（技能名称 + 所需星级）。 */
  const skillReqField = field({
    label: '技能要求', name: 'task-skill', required: true,
    options: [{ value: '', label: '（选择所需技能）' }, ...SKILL_NAME_FALLBACK.map((n) => ({ value: n, label: n }))],
    hint: '任务需要的技能方向，与成员技能认证的技能名称一致；选「其他」可手填。',
  });
  const skillReqOtherField = field({
    label: '技能名称（其他）', name: 'task-skill-other', maxlength: 30, placeholder: '请填写技能名称',
  });
  skillReqOtherField.hidden = true;
  skillReqField.control.addEventListener('change', () => {
    skillReqOtherField.hidden = skillReqField.control.value !== SKILL_OTHER;
  });
  const skillStarsField = field({
    label: '所需技能星级', name: 'task-skill-stars', required: true,
    options: [{ value: '', label: '（选择所需星级）' }, ...STAR_LEVELS.map((s) => ({ value: String(s.level), label: `${s.level} 星 · ${s.label}` }))],
    hint: '要求成员在该技能上达到的星级。',
  });
  const descField = field({ label: '任务说明', name: 'task-desc', multiline: true, rows: 3, maxlength: 400, placeholder: '任务说明：做什么、什么时候、交付什么' });
  const publishButton = button({ label: '发布任务', variant: 'primary', iconName: 'send', onClick: () => publish() });

  async function publish() {
    const body = {
      title: titleField.control.value.trim(),
      description: descField.control.value.trim(),
      type: typeField.control.value,
      stars: Number(starsField.control.value) || 0,
      skillRequirement: skillReqField.control.value,
      skillRequirementOther: skillReqField.control.value === SKILL_OTHER ? skillReqOtherField.control.value.trim() : '',
      skillStars: Number(skillStarsField.control.value) || 0,
    };
    if (!body.skillRequirement) { notify.warning('请选择技能要求', '任务需要标注所需技能方向。'); return; }
    if (body.skillRequirement === SKILL_OTHER && !body.skillRequirementOther) { notify.warning('请填写技能名称', '选择「其他」时需手动填写。'); return; }
    if (!body.skillStars) { notify.warning('请选择所需技能星级', '任务需要标注要求的星级。'); return; }
    try {
      const payload = await runWithLoading(publishButton, () => consoleApi.tasks.publish(body));
      notify.success('任务已发布', payload.message || body.title);
      titleField.control.value = '';
      descField.control.value = '';
      starsField.control.value = '';
      skillReqField.control.value = '';
      skillReqOtherField.control.value = '';
      skillReqOtherField.hidden = true;
      skillStarsField.control.value = '';
      await load();
    } catch (error) {
      if (redirectIfAuthError(error)) return;
      if (error instanceof ApiError) notify.warning('发布未成功', error.message);
      else reportError(error, '发布失败');
    }
  }

  /* --- 渲染 --------------------------------------------------------------- */

  function taskCard(task) {
    const open = task.status === '待认领';
    const reviewing = task.status === '申领审核中';
    return h('article', { class: 'card stack-3' },
      h('div', { class: 'row-3 row-wrap' },
        h('h3', { class: 't-h3', text: task.title }),
        h('span', { class: 'spacer' }),
        starChip(task.stars)),
      task.description ? h('p', { class: 't-secondary', text: task.description }) : null,
      h('div', { class: 'row-3 row-wrap' },
        h('span', { class: 'chip chip--static' }, h('span', { text: task.type || '未分类' })),
        task.skillRequirement
          ? h('span', { class: 'chip chip--static' }, h('span', { text: `技能：${task.skillRequirement}${task.skillStars ? ` · ${task.skillStars} 星` : ''}` }))
          : null,
        badge(task.status, { tone: open ? 'success' : reviewing ? 'warning' : 'neutral', iconName: open ? 'inbox' : 'check' }),
        h('span', { class: 't-caption t-faint', text: `发布 ${fmt.relative(task.publishedAt)}` }),
        h('span', { class: 'spacer' }),
        open
          ? button({ label: '我来申领', variant: 'primary', iconName: 'check', onClick: (event) => claimTask(task, event?.currentTarget) })
          : h('span', { class: 't-caption t-faint', text: reviewing ? '有成员申领，待管理员审核' : `已被认领 ${fmt.relative(task.claimedAt)}` })));
  }

  function claimCard(claim) {
    const tone = claim.status === '已通过' ? 'success' : claim.status === '已驳回' ? 'error' : 'warning';
    return h('article', { class: 'card stack-2' },
      h('div', { class: 'row-3 row-wrap' },
        h('h3', { class: 't-h3', text: claim.task?.title || '（任务已删除）' }),
        h('span', { class: 'spacer' }),
        badge(claim.status, { tone, iconName: 'check' })),
      claim.task?.skillRequirement
        ? h('p', { class: 't-caption t-faint', text: `技能要求：${claim.task.skillRequirement}${claim.task.skillStars ? ` · ${claim.task.skillStars} 星` : ''}` })
        : null,
      claim.note ? h('p', { class: 't-secondary', text: `我的留言：${claim.note}` }) : null,
      claim.reviewNote ? h('p', { class: 't-caption t-secondary', text: `审核意见：${claim.reviewNote}` }) : null,
      h('span', { class: 't-caption t-faint', text: `提交于 ${fmt.fullDateTime(claim.at)}` }));
  }

  function renderPublishPanel() {
    if (!canPublish) return null;
    return h('section', { class: 'card stack-4' },
      h('div', { class: 'row-3 row-wrap' },
        h('h2', { class: 't-h3', text: '发布任务' }),
        badge('仅宣传中心有权限者可见', { tone: 'neutral', iconName: 'shield' })),
      h('p', { class: 't-caption t-faint', text: '发布时请自评任务星级（1-5），并标注所需技能与星级：星级越高，越会排在心愿清单前面，也越可能吸引到有对应技能的成员。' }),
      h('div', { class: 'wscols' }, titleField, typeField),
      starsField,
      h('div', { class: 'wscols' }, skillReqField, skillStarsField),
      skillReqOtherField,
      descField,
      h('div', { class: 'row-3' }, publishButton));
  }

  function renderList() {
    clear(listSlot);
    if (state.loading) {
      listSlot.append(notice('正在加载心愿清单…', { tone: 'info', iconName: 'clock' }));
      return;
    }

    const tabs = segmented({
      items: [
        { value: 'wishlist', label: `心愿清单（${state.stats.open}）` },
        { value: 'mine', label: `我申领的（${state.claims.length}）` },
        { value: 'publish', label: '发布任务' },
      ],
      value: state.tab,
      ariaLabel: '任务申领视图',
      onChange: (value) => { state.tab = value; renderList(); },
    });

    if (state.tab === 'publish') {
      const panel = canPublish
        ? renderPublishPanel()
        : emptyState({ iconName: 'lock', title: '没有发布权限', description: '任务发布由宣传中心成员负责。你可以在「心愿清单」里认领任务。' });
      listSlot.append(tabs, panel);
      return;
    }

    if (state.tab === 'mine') {
      listSlot.append(
        tabs,
        state.claims.length
          ? h('div', { class: 'stack-4' }, ...state.claims.map(claimCard))
          : emptyState({ iconName: 'inbox', title: '还没有申领任务', description: '去「心愿清单」看看有哪些任务适合你。' }));
      return;
    }

    const open = state.tasks.filter((task) => task.status === '待认领');
    const done = state.tasks.filter((task) => task.status !== '待认领');
    listSlot.append(
      tabs,
      state.myStars
        ? notice(`你的技能星级：${state.myStars} 星。星级越高，越适合认领高星任务。`, { tone: 'info', iconName: 'star' })
        : notice('还没有审核通过的技能星级。可在「会员中心 · 我的技能」提交技能，审核通过后星级会显示在这里。', { tone: 'neutral', iconName: 'info' }),
      open.length
        ? h('div', { class: 'stack-4' }, ...open.map(taskCard))
        : emptyState({ iconName: 'inbox', title: '心愿清单暂时空着', description: '等宣传中心发布新任务后，这里会出现可以认领的任务。' }),
      done.length
        ? h('details', { class: 'stack-3' },
          h('summary', { class: 't-label', text: `已认领 / 已关闭（${done.length}）` }),
          h('div', { class: 'stack-4' }, ...done.map(taskCard)))
        : null,
    );
  }

  /* --- mount -------------------------------------------------------------- */

  const node = h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      h('div', { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/outreach' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回宣传广场' })),
        h('div', { class: 'row-3 row-wrap' }, h('p', { class: 't-label', text: '宣传广场 · 任务申领' }), badge('心愿清单', { tone: 'accent', iconName: 'target' })),
        h('h1', { class: 't-h1', text: '任务申领' }),
        h('p', { class: 't-prose', text: '这里是红会宣传工作的「心愿清单」：谁需要帮忙、需要什么技能，都写在上面。按星级排序，看得上就认领，认领后发布人会收到通知。' })),
      isSignedIn() ? listSlot : loginRequiredPanel({ what: '任务申领', hint: '认领记录与你的账号绑定，换设备也能找回。' })));

  if (isSignedIn()) await load();

  return { title: '任务申领', node };
}
