/* ==========================================================================
   气候哨兵 · 韧性社区 入口卡片 —— 在「内建广场」固定展示。
   与 UNO 卡并列，由 warmth-birthday / warmth-legacy 各自构造。
   ========================================================================== */
import { h, icon } from '../core/dom.js';
import { button } from '../ui/primitives.js';
import { LOGO } from '../games/climate/data.js';

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-climate-entry-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/styles/climate-entry.css';
  link.dataset.climateEntryStyle = '1';
  document.head.append(link);
}

export function buildClimateCard() {
  ensureStyles();
  return h('article', { class: 'community-program community-program--climate', id: 'climate-entry' },
    h('div', { class: 'community-program__top' }, h('span', { text: '24 角色 · 共创桌游' }), icon('sparkle', 'ico')),
    h('div', { class: 'community-art community-art--climate', attrs: { 'aria-hidden': 'true' } },
      h('img', { attrs: { src: LOGO, alt: '' } })),
    h('div', { class: 'community-program__copy' },
      h('h2', { text: '气候哨兵 · 韧性社区' }),
      h('p', { text: '气候变化与人道行动主题的身份推理桌游。核实线索、守住韧性、找出灾谣首领。' }),
      h('p', { class: 'community-program__description', text: '协调员魔典工具，支持 5–13 人；24 名玩家共创角色与 8 张天气卡。非官方、非商业的内部娱乐功能。' })),
    h('div', { class: 'community-program__participation' },
      h('span', { class: 'community-program__status', text: '无需登录即可使用' }),
      h('div', { class: 'community-program__actions' },
        button({ label: '查看魔典', href: '/games/climate', variant: 'primary', iconAfter: 'arrowRight' }))),
    h('details', { class: 'community-program__privacy' },
      h('summary', { text: '玩法说明' }),
      h('p', { text: '社区与灾谣两阵营，白天提名表决、夜晚秘密行动。韧性初始 3、上限 4，归零则灾谣获胜；首领离队且无人接任则社区获胜。' }),
      h('ul', null, ...['由协调员掌握真实身份并执行流程', '角色与科普内容须经相关工作者审核后正式宣传', '规则以完整规则书与策划案为准'].map((item) => h('li', { text: item })))));
}
