import { h } from '../../core/dom.js';
import { emptyState, pageHead } from '../../ui/primitives.js';
import { materialServices } from '../../shared/material-services.js';

export default async function materialsRoomsPage() {
  return { title: '场地借用', crumb: '场地借用', node: h('div', { class: 'view wspad wspad--wide' },
    materialServices('venue', { console: true }),
    pageHead({ label: '物资服务', title: '场地借用', description: '管理校内活动室借用与预约安排。' }),
    h('section', { class: 'panel material-venue-placeholder' },
      emptyState({ iconName: 'door', title: '活动室预约功能建设中',
        description: '场地清单、可借时段与预约登记正在整理中，稍后开放。' }))) };
}
