/* Shared top-level switch for the two independent warmth programmes. */

import { h, icon } from '../core/dom.js';

const MODULES = Object.freeze([
  {
    id: 'morning',
    path: '/console/community/morning',
    label: '早安晚安',
    description: '报名名片审核、发布与同行广场',
    iconName: 'handshake',
  },
  {
    id: 'birthday',
    path: '/console/community/birthday',
    label: '生日祝福',
    description: '参加同意、祝福审核、举报与匹配预览',
    iconName: 'sparkle',
  },
]);

export function communityModuleNav(activeModule) {
  return h(
    'nav',
    { class: 'community-module-nav', attrs: { 'aria-label': '温暖连接模块' } },
    h(
      'div',
      { class: 'community-module-nav__intro' },
      h('p', { class: 't-label', text: '温暖连接' }),
      h('p', { class: 't-secondary t-strong', text: '选择业务模块' }),
      h('p', { class: 't-caption', text: '两个模块独立管理，不共用业务状态。' }),
    ),
    h(
      'div',
      { class: 'community-module-nav__items' },
      ...MODULES.map((module) => {
        const active = module.id === activeModule;
        return h(
          'a',
          {
            class: 'community-module-nav__item',
            href: module.path,
            data: { active: String(active) },
            aria: { current: active ? 'page' : null },
          },
          h('span', { class: 'community-module-nav__icon' }, icon(module.iconName, 'ico ico--lg')),
          h(
            'span',
            { class: 'community-module-nav__text' },
            h('b', { text: module.label }),
            h('span', { text: module.description }),
          ),
          icon('arrowRight', 'ico ico--sm community-module-nav__arrow'),
        );
      }),
    ),
  );
}
