/* ==========================================================================
   portal/pages/materials.js
   Task: materials centre hub — entry to borrowing, reimbursement, activity
   rooms and inbound registration.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { button } from '../../ui/primitives.js';

const MODULES = [
  { title: '物资借用', iconName: 'box', href: '/materials/borrow', heading: '申请借用活动所需物资', description: '急救箱、血压计、展架与活动器材面向校内活动开放借用。', detail: '在线申请 · 审批出库 · 拍照留痕' },
  { title: '财务报销', iconName: 'file', href: '/materials/reimburse', heading: '活动经费报销登记', description: '填写报销事项与金额并关联对应活动，方便财务核对入账。', detail: '关联活动 · 金额明细 · 凭证上传' },
  { title: '活动室使用', iconName: 'door', href: '/materials/rooms', heading: '借用活动室与场地', description: '申请校内活动室，用于培训、会议与小型活动。', detail: '场地预约 · 使用登记' },
  { title: '物资入库登记', iconName: 'inbox', href: '/materials/inbound', heading: '新物资入库登记', description: '登记新采购或捐赠物资的种类、数量与存放位置。', detail: '登记入库 · 待管理员审核' },
];

export default async function materialsPage() {
  return { title: '物资广场', node: h('div', { class: 'view' },
    h('section', { class: 'psection square-intro' },
      h('p', { class: 't-label', text: '物资广场' }),
      h('h1', { class: 't-h1', text: '每一件物资，都服务一场公益' }),
      h('p', { class: 't-prose', text: '借用急救器材、报销活动经费、预约活动室、登记新物资——物资广场把活动背后的后勤事务收拢到一处。' }),
      h('div', { class: 'row-3 row-wrap' }, button({ label: '申请借用物资', href: '/materials/borrow', variant: 'primary', iconName: 'box' }), button({ label: '财务报销', href: '/materials/reimburse', variant: 'secondary', iconName: 'file' }))),
    h('section', { class: 'psection psection--tight' },
      h('div', { class: 'square-grid' }, ...MODULES.map((m) =>
        h('a', { class: 'square-card', href: m.href },
          h('span', { class: 'square-card__icon' }, icon(m.iconName, 'ico ico--lg')),
          h('h2', { class: 't-h2', text: m.heading }),
          h('p', { class: 't-secondary', text: m.description }),
          h('p', { class: 't-caption', text: m.detail }),
          h('span', { class: 'square-card__action' }, h('span', { text: '进入' }), icon('arrowRight', 'ico ico--sm')))))),
  ) };
}
