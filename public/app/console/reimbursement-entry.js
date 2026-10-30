import { getSessionState, hasPermission } from '../core/api.js';
import { h } from '../core/dom.js';
import { button, notice, pageHead } from '../ui/primitives.js';
import { materialServices } from '../shared/material-services.js';
import { reimbursementsApi } from '../shared/reimbursements-api.js';

/** Keep an unassigned administrator on the requested page without loading records. */
export async function loadReimbursementConsolePage(loader) {
  const user = getSessionState().user;
  if (user?.localPreview === true || user?.financePermissions?.length) return loader();
  const config = await reimbursementsApi.config();
  if (config.workflow?.permissions?.length) return loader();
  return { default: async () => ({ title: '财务报销', crumb: '财务报销', node: h('div', { class: 'view wspad' },
    materialServices('finance', { console: true }),
    pageHead({ label: '财务报销', title: '财务报销', description: '查看财务服务状态与当前账号的访问权限。' }),
    config.available === false ? notice(config.message, { tone: 'neutral', title: '财务服务尚未开放' }) : null,
    notice('当前账号未分配财务查看或审核权限。报销审核按指定财务账号分工开放，请联系财务负责人核对当前账号。', { tone: 'warning', title: '未分配财务权限' }),
    h('div', { class: 'row-3 row-wrap' },
      button({ label: '重新检查权限', variant: 'secondary', href: location.pathname + location.search }),
      button({ label: hasPermission('materials') ? '返回物资管理' : '返回管理总览', variant: 'ghost', href: hasPermission('materials') ? '/console/materials' : '/console/overview' })),
  ) }) };
}
