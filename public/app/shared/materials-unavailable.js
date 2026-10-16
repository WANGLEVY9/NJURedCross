import { h } from '../core/dom.js';
import { emptyState } from '../ui/primitives.js';

export default function unavailable() {
  return { title: '服务尚未开放', node: h('section', { class: 'view wspad' },
    emptyState({ title: '此项服务尚未开放', iconName: 'box',
      description: '新流程正在进行持久化与权限联调；现有物资借用与管理继续正常使用。' }),
    h('a', { href: location.pathname.startsWith('/console/') ? '/console/materials' : '/materials',
      class: 'btn btn--secondary', text: '返回物资服务' })) };
}
