/* ==========================================================================
   portal/pages/materials.js
   Task: materials centre hub — entry to borrowing, reimbursement, activity
   rooms and loan returns.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';

const MODULES = [
  { title: '物资借用', iconName: 'box', href: '/materials/borrow', description: '急救箱、血压计、展架与活动器材面向校内活动开放借用。', detail: '在线申请 · 审批出库 · 拍照留痕' },
  { title: '物资归还', iconName: 'inbox', href: '/materials/return', description: '选择原借用单，登记实际归还数量并上传照片，管理员现场核对后入账。', detail: '关联借用 · 分次归还 · 核对入账' },
  { title: '报销登记', iconName: 'file', href: '/materials/reimburse', description: '填写报销事项与金额并关联对应活动，上传材料后由财务核对。', detail: '关联活动 · 金额明细 · 凭证上传' },
  { title: '场地借用', iconName: 'door', href: '/materials/rooms', description: '场地借用暂未开放，后续统一接入预约与使用登记。', detail: '暂未开放' },
];

export default async function materialsPage() {
  return { title: '物资广场', node: h('div', { class: 'view' },
    h('section', { class: 'psection square-intro' },
      h('p', { class: 't-label', text: '物资广场' }),
      h('h1', { class: 't-h1', text: '每一件物资，都服务一场公益' }),
      h('p', { class: 't-prose', text: '借用和归还物资、登记活动报销，在这里办理活动所需的后勤事务。场地借用稍后开放。' })),
    h('section', { class: 'psection psection--tight' },
      h('div', { class: 'square-grid' }, ...MODULES.map((m) =>
        h('a', { class: 'square-card', href: m.href },
          h('span', { class: 'square-card__icon' }, icon(m.iconName, 'ico ico--lg')),
          h('h2', { class: 't-h2', text: m.title }),
          h('p', { class: 't-secondary', text: m.description }),
          h('p', { class: 't-caption', text: m.detail }),
          h('span', { class: 'square-card__action' }, h('span', { text: '进入' }), icon('arrowRight', 'ico ico--sm')))))),
  ) };
}
