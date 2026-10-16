import { h, icon } from '../core/dom.js';

/** Keep the four services in one small navigation row, without multiplying the global sidebar. */
export function materialServices(active, { console: admin = false } = {}) {
  const items = [
    ['loan', '物资借用', admin ? '/console/materials' : '/materials/borrow'],
    [admin ? 'intake' : 'return', admin ? '出入库登记' : '物资归还', admin ? '/console/materials/intake' : '/materials/return'],
    ['finance', '财务报销', admin ? '/console/reimbursements' : '/materials/reimburse'],
    ['venue', '场地借用', admin ? '/console/materials/rooms' : '/materials/rooms'],
  ];
  const icons = { loan: 'box', return: 'inbox', finance: 'file', venue: 'pin', intake: 'scan' };
  return h('nav', { class: 'material-services', aria: { label: '物资服务' } }, ...items.map(([id, label, href]) => href
    ? h('a', { href, class: ['material-services__item', id === active ? 'is-active' : ''], aria: { current: id === active ? 'page' : null } },
      icon(icons[id], 'ico ico--sm'), h('span', { text: label }))
    : h('span', { class: 'material-services__item is-disabled', title: id === 'venue' ? '暂未开放' : '由管理人员操作' },
      icon(icons[id], 'ico ico--sm'), h('span', { text: label }),
      h('small', { class: 'material-services__hint', text: id === 'venue' ? '待开放' : '管理端' }))));
}
