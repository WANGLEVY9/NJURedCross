/* ==========================================================================
   portal/pages/materials-rooms.js
   Task: activity room usage — placeholder. The room list and booking flow are
   not yet designed; this page states what is coming.
   ========================================================================== */

import { h, icon } from '../../core/dom.js';
import { emptyState, notice } from '../../ui/primitives.js';

export default async function materialsRoomsPage() {
  return { title: '活动室使用', node: h('div', { class: 'view' },
    h('div', { class: 'formpage' },
      h('header', { class: 'stack-3' },
        h('a', { class: 't-caption t-muted row-2', href: '/materials' }, icon('chevronLeft', 'ico ico--sm'), h('span', { text: '返回物资广场' })),
        h('p', { class: 't-label', text: '物资广场 · 场地' }),
        h('h1', { class: 't-h1', text: '活动室使用' }),
        h('p', { class: 't-prose', text: '借用校内活动室，用于培训、会议与小型活动。' }),
      ),
      h('div', { class: 'panel panel--raised' },
        h('div', { class: 'panel__body stack-4' },
          emptyState({ iconName: 'door', title: '活动室预约功能建设中', description: '场地清单、可借时段与预约登记正在整理中，稍后开放。' }),
          notice('如需使用活动室，可先联系红十字会管理员线下登记。', { tone: 'info', title: '临时安排' }),
        ),
      ),
    ),
  ) };
}
