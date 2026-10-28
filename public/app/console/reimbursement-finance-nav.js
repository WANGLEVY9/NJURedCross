import { h } from '../core/dom.js';
const tabs = [['items', '全部条目'], ['activities', '活动终审'], ['payments', '待打款'], ['records', '报销单记录']];
export function financeNavigation(active) {
  return h('nav', { class: 'finance-tabs', aria: { label: '终审财务工作台' } }, ...tabs.map(([key, label]) => h('a', {
    href: `/console/reimbursements?view=${key}`, class: `finance-tabs__tab${key === active ? ' is-active' : ''}`,
    ...(key === active ? { 'aria-current': 'page' } : {}), text: label,
  })));
}
export const financeSelection = row => ({ requestId: row.requestId, itemId: row.itemId, revision: row.revision, stateVersion: row.stateVersion });
export const financeRowKey = row => JSON.stringify([row.requestId, row.itemId]);
export const financeTable = (labels, body) => h('div', { class: 'finance-table-scroll', tabindex: 0, aria: { label: '报销条目表，可横向滚动查看' } },
  h('table', { class: 'finance-table' }, h('thead', {}, h('tr', {}, ...labels.map(label => h('th', { scope: 'col', text: label })))), h('tbody', {}, ...body)));
