import { h, clear } from '../../core/dom.js';
import { request, ApiError } from '../../core/api.js';
import { button, field, badge, notice } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';

/* ==========================================================================
   portal/pages/me-skills.js — 「我的技能」面板（v3 S5 / 第 8 项 / D3 / D6）。

   会员中心被 main 拆成 me-birthday.js / me-legacy.js 两条渲染路径，本模块把
   v3 的技能提交与查看抽成共享组件，两条路径都挂同一块，避免复制代码。
   会员只能看到自己的技能；星级由管理员审核通过后写入账号。
   ========================================================================== */

/**
 * 生成一个自加载的「我的技能」section（id=member-skills，便于 #member-skills 锚点定位）。
 * @returns {HTMLElement}
 */
export function createSkillsSection() {
  const skillsSlot = h('div', { class: 'stack-4' });
  const skillNameField = field({ label: '技能名称', name: 'skill-name', placeholder: '如：摄影 / 平面设计 / 推文排版', maxlength: 30, required: true });
  const skillStarsField = field({
    label: '自评星级', name: 'skill-stars', required: true,
    options: [{ value: '', label: '（自评星级）' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} 星` }))],
  });
  const skillDescField = field({ label: '技能说明（必填）', name: 'skill-desc', multiline: true, rows: 3, maxlength: 300, required: true, placeholder: '说明你的经验与可承担的任务，如「拍摄过 10 场校级活动并独立完成后期」' });
  const skillProofField = field({ label: '证明链接（可选）', name: 'skill-proof', placeholder: '作品集 / 往期推文链接' });
  const skillSubmitButton = button({ label: '提交技能', variant: 'primary', iconName: 'send', onClick: () => submitSkill() });

  async function submitSkill() {
    const body = {
      name: skillNameField.control.value.trim(),
      description: skillDescField.control.value.trim(),
      selfStars: Number(skillStarsField.control.value) || 0,
      proof: skillProofField.control.value.trim(),
    };
    try {
      const payload = await request('/api/portal/skills', { method: 'POST', body });
      notify.success('已提交技能', payload.message || '等待管理员审核');
      skillNameField.control.value = '';
      skillDescField.control.value = '';
      skillStarsField.control.value = '';
      skillProofField.control.value = '';
      await loadSkills();
    } catch (error) {
      if (error instanceof ApiError) notify.warning('提交未成功', error.message);
      else reportError(error, '技能提交失败');
    }
  }

  async function loadSkills() {
    clear(skillsSlot);
    let payload;
    try {
      payload = await request('/api/portal/skills');
    } catch {
      skillsSlot.append(notice('技能信息暂时无法加载。', { tone: 'info', iconName: 'info' }));
      return;
    }
    const skills = payload.skills || [];
    skillsSlot.append(
      h('div', { class: 'row-3 row-wrap' },
        h('span', { class: 't-caption t-faint', text: '我的技能星级：' }),
        badge(payload.stars ? `${payload.stars} 星` : '尚未获得星级', { tone: payload.stars ? 'accent' : 'neutral', iconName: 'star' })),
      h('p', { class: 't-caption t-faint', text: '技能说明为必填。管理员审核通过后，星级会写入账号，并用于任务申领时的匹配参考。' }),
      h('div', { class: 'wscols' }, skillNameField, skillStarsField),
      skillDescField,
      skillProofField,
      h('div', { class: 'row-3' }, skillSubmitButton),
      skills.length
        ? h('div', { class: 'stack-3' },
          h('p', { class: 't-label', text: '已提交的技能' }),
          ...skills.map((skill) => h('div', { class: 'card stack-2' },
            h('div', { class: 'row-3 row-wrap' },
              h('span', { class: 't-body', text: skill.name }),
              badge(`${skill.selfStars} 星`, { tone: 'neutral', iconName: 'star' }),
              h('span', { class: 'spacer' }),
              badge(skill.status, { tone: skill.status === '已通过' ? 'success' : skill.status === '已驳回' ? 'error' : 'warning' })),
            h('p', { class: 't-caption t-secondary', text: skill.description || '（无说明）' }),
            skill.reviewNote ? h('p', { class: 't-caption t-faint', text: `审核意见：${skill.reviewNote}` }) : null)))
        : notice('还没有提交过技能。填好上面的表单即可提交，等待管理员审核。', { tone: 'neutral', iconName: 'info' }),
    );
  }

  const section = h('section', { id: 'member-skills', class: 'stack-4 member-anchor' },
    h('h2', { class: 't-h2', text: '我的技能' }),
    h('p', { class: 't-prose', text: '提交你的技能与经验，管理员审核后会写入技能星级；星级会用在「任务申领」里，方便发布人找到合适的人。' }),
    skillsSlot);
  loadSkills();
  return section;
}
