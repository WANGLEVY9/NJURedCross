import { h, clear } from '../../core/dom.js';
import { request, ApiError } from '../../core/api.js';
import { button, field, badge, notice, checkbox } from '../../ui/primitives.js';
import { notify, reportError } from '../../core/toast.js';

/* ==========================================================================
   portal/pages/me-skills.js — 「我的技能」面板（v3 S5 / 第 8 项 / D3 / D6）。

   v3.1（2026-10-11 用户定案）改造：
     · 技能名称 → 下拉选择（8 项），选「其他」时手填；
     · 新增「常用软件」多选（13 项），选「其他」时手填；
     · 技能名称为「绘图与二创」时，往期作品提交链接**必填**。

   会员中心被 main 拆成 me-birthday.js / me-legacy.js 两条渲染路径，本模块把
   v3 的技能提交与查看抽成共享组件，两条路径都挂同一块，避免复制代码。
   会员只能看到自己的技能；星级由管理员审核通过后写入账号。
   ========================================================================== */

/** 字典兜底（与 lib/attachment/store.js 保持一致；服务端返回时覆盖）。 */
const SKILL_NAME_FALLBACK = ['图片处理', '公众号排版', '海报设计', '绘图与二创',
  '板写与 logo 设计', '动画与 live 2D', '3D建模', '其他'];
const SKILL_SOFTWARE_FALLBACK = ['Procreate', '画世界 pro', '天生会画', 'PS', 'AI', 'Canva', '秀米',
  'Tinkercad', 'Blender', '3Dmax', 'AE', 'Live2D Cubism Editor', '其他'];
const SKILL_OTHER = '其他';
const PORTFOLIO_REQUIRED_FOR = '绘图与二创';

/**
 * 生成一个自加载的「我的技能」section（id=member-skills，便于 #member-skills 锚点定位）。
 * @returns {HTMLElement}
 */
export function createSkillsSection() {
  const skillsSlot = h('div', { class: 'stack-4' });

  // ---- 表单字段 ----
  const skillNameField = field({
    label: '技能名称', name: 'skill-name', required: true,
    options: [
      { value: '', label: '（选择技能名称）' },
      ...SKILL_NAME_FALLBACK.map((name) => ({ value: name, label: name })),
    ],
    hint: '从下拉中选择；若都不合适，选「其他」并手填。',
  });
  const skillNameOtherField = field({
    label: '技能名称（其他）', name: 'skill-name-other', maxlength: 30, required: true,
    placeholder: '请填写技能名称，如：视频剪辑',
  });
  skillNameOtherField.hidden = true;

  const skillStarsField = field({
    label: '自评星级', name: 'skill-stars', required: true,
    options: [{ value: '', label: '（自评星级）' }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} 星` }))],
  });

  // ---- 常用软件（多选）----
  const softwareBoxes = new Map(); // 名称 → checkbox 节点
  const softwareGrid = h('div', { class: 'stack-2' },
    ...SKILL_SOFTWARE_FALLBACK.map((name) => {
      const node = checkbox({ name: `skill-sw-${name}`, label: name });
      softwareBoxes.set(name, node);
      return node;
    }));
  const softwareOtherField = field({
    label: '其他软件', name: 'skill-software-other', maxlength: 40,
    placeholder: '请填写软件名称，如：Figma',
  });
  softwareOtherField.hidden = true;
  const softwareField = h('div', { class: 'field' },
    h('label', { class: 'field__label' }, h('span', { text: '常用软件（可多选）' }), h('span', { class: 'field__req', text: '必填' })),
    softwareGrid,
    softwareOtherField,
    h('p', { class: 'field__hint', text: '至少选择一项；选「其他」时请手填软件名称。' }),
    h('p', { class: 'field__error', attrs: { role: 'alert' }, hidden: true }));

  const skillDescField = field({ label: '技能说明（必填）', name: 'skill-desc', multiline: true, rows: 3, maxlength: 300, required: true, placeholder: '说明你的经验与可承担的任务，如「拍摄过 10 场校级活动并独立完成后期」' });
  const skillProofField = field({ label: '往期作品链接', name: 'skill-proof', placeholder: '作品集 / 往期推文链接' });
  const skillSubmitButton = button({ label: '提交技能', variant: 'primary', iconName: 'send', onClick: () => submitSkill() });

  // ---- 联动 ----
  function syncNameOther() {
    skillNameOtherField.hidden = skillNameField.control.value !== SKILL_OTHER;
  }
  function syncPortfolioHint() {
    const required = skillNameField.control.value === PORTFOLIO_REQUIRED_FOR;
    const label = skillProofField.querySelector('.field__label');
    if (label) {
      const old = label.querySelector('.field__req');
      if (required && !old) label.append(h('span', { class: 'field__req', text: '必填' }));
      if (!required && old) old.remove();
    }
    const hint = skillProofField.querySelector('.field__hint');
    if (hint) hint.textContent = required ? '选择「绘图与二创」时必填：请附上往期作品链接。' : '可选：作品集或往期推文链接。';
  }
  function softwareOtherChecked() {
    const node = softwareBoxes.get(SKILL_OTHER);
    return Boolean(node?.control?.checked);
  }
  function syncSoftwareOther() {
    softwareOtherField.hidden = !softwareOtherChecked();
  }
  skillNameField.control.addEventListener('change', () => { syncNameOther(); syncPortfolioHint(); });
  const otherSoftwareNode = softwareBoxes.get(SKILL_OTHER);
  otherSoftwareNode?.control?.addEventListener('change', syncSoftwareOther);
  syncPortfolioHint();

  function collectSoftwares() {
    const picked = [];
    for (const [name, node] of softwareBoxes) {
      if (name === SKILL_OTHER) continue;
      if (node.control?.checked) picked.push(name);
    }
    if (softwareOtherChecked()) {
      const typed = softwareOtherField.control.value.trim();
      if (typed) picked.push(typed);
    }
    return picked;
  }

  function resetForm() {
    skillNameField.control.value = '';
    skillNameOtherField.control.value = '';
    skillStarsField.control.value = '';
    skillDescField.control.value = '';
    skillProofField.control.value = '';
    softwareOtherField.control.value = '';
    for (const node of softwareBoxes.values()) {
      if (node.control) node.control.checked = false;
      node.dataset.checked = 'false';
    }
    skillNameOtherField.hidden = true;
    softwareOtherField.hidden = true;
    skillNameField.setError(null);
    skillNameOtherField.setError(null);
    skillDescField.setError(null);
    skillProofField.setError(null);
  }

  async function submitSkill() {
    const selected = skillNameField.control.value;
    const softwares = collectSoftwares();
    let invalid = null;
    skillNameField.setError(null);
    skillNameOtherField.setError(null);
    skillDescField.setError(null);
    skillProofField.setError(null);

    if (!selected) { skillNameField.setError('请选择技能名称'); invalid = invalid || skillNameField; }
    if (selected === SKILL_OTHER && !skillNameOtherField.control.value.trim()) {
      skillNameOtherField.setError('选择「其他」时请填写技能名称');
      invalid = invalid || skillNameOtherField;
    }
    if (!softwares.length) { invalid = invalid || softwareField; }
    if (skillDescField.control.value.trim().length < 10) { skillDescField.setError('技能说明至少 10 个字'); invalid = invalid || skillDescField; }
    if (!skillStarsField.control.value) { skillStarsField.setError('请选择自评星级'); invalid = invalid || skillStarsField; }
    if (selected === PORTFOLIO_REQUIRED_FOR && !skillProofField.control.value.trim()) {
      skillProofField.setError('技能为「绘图与二创」时，往期作品链接必填');
      invalid = invalid || skillProofField;
    }
    if (!softwares.length) {
      notify.warning('请至少选择一项常用软件', '技能需要标注你常用的工具，方便任务匹配。');
      return;
    }
    if (invalid) return;

    const body = {
      name: selected,
      nameOther: selected === SKILL_OTHER ? skillNameOtherField.control.value.trim() : '',
      softwares,
      description: skillDescField.control.value.trim(),
      selfStars: Number(skillStarsField.control.value) || 0,
      proof: skillProofField.control.value.trim(),
    };
    try {
      const payload = await request('/api/portal/skills', { method: 'POST', body });
      notify.success('已提交技能', payload.message || '等待管理员审核');
      resetForm();
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
      h('p', { class: 't-caption t-faint', text: '技能名称请从下拉中选择，并标注常用软件；技能说明为必填。管理员审核通过后，星级会写入账号，并用于任务申领时的匹配参考。' }),
      h('div', { class: 'wscols' }, skillNameField, skillStarsField),
      skillNameOtherField,
      softwareField,
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
            (skill.softwares || []).length
              ? h('p', { class: 't-caption t-secondary', text: `常用软件：${skill.softwares.join('、')}` })
              : null,
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
