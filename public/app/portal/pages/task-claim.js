/* ==========================================================================
   portal/pages/task-claim.js
   任务申领（v3 S5 / 第 8 项 + D6）——「心愿清单」页。

   两块内容：
     1. 心愿清单：待认领任务，按「星级要求」降序 + 发布时间升序排列。
        成员可一键认领（写入任务申领表 + 任务表状态）。
     2. 我认领的任务：本人已认领记录，便于回看与跟进。

   2026-10-27 定案：**任务发布整体移到管理端**（/console/outreach → 任务发布），
   用户端只保留「认领 / 我的申领」两件事。发布权限、星级自评与技能要求仍在，
   但只在控制台出现，避免成员在心愿清单里看到发布表单。
   ========================================================================== */

import { h, icon, clear } from '../../core/dom.js';
import { publicApi, ApiError } from '../../core/api.js';
import { button, notice, badge, emptyState, segmented, runWithLoading } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';
import * as fmt from '../../core/format.js';
import { isSignedIn, loginRequiredPanel, redirectIfAuthError } from '../auth-gate.js';
import { requestText } from '../../ui/overlay.js';

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
  };

  const listSlot = h('div', { class: 'stack-6' });

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
    const note = await requestText({ title: `申领任务「${task.title}」`, label: '申领备注', description: '可以留一句话给发布人（可留空）。提交后需管理员审核，通过才正式接单。' });
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
      ],
      value: state.tab,
      ariaLabel: '任务申领视图',
      onChange: (value) => { state.tab = value; renderList(); },
    });

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
    // 只 append 真实节点：直接 append(null) 会把字符串 "null" 渲染到页面上。
    listSlot.append(...[
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
    ].filter(Boolean));
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
