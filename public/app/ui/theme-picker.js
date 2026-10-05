import { h, icon } from '../core/dom.js';
import { THEMES, currentTheme, themeMotionEnabled, selectTheme, setThemeMotion } from '../core/themes.js';
import { openDrawer } from './overlay.js';
import { button } from './primitives.js';

export function themeButton(surface) {
  return h('button', { type: 'button', class: 'icon-btn theme-trigger', title: '外观主题', aria: { label: '外观主题' }, on: { click: () => openThemePicker(surface) } }, icon('sparkle', 'ico ico--sm'));
}
export function openThemePicker(surface) {
  const chosen = currentTheme(surface);
  const choices = h('div', { class: 'theme-grid', attrs: { role: 'group', 'aria-label': '选择外观主题' } },
    ...THEMES[surface].map(theme => h('label', { class: 'theme-choice' },
      h('input', { type: 'radio', name: 'appearance-theme', value: theme.id, checked: theme.id === chosen.id,
        on: { change: () => selectTheme(surface, theme.id) } }),
      h('span', { class: 'theme-choice__preview', attrs: { 'aria-hidden': 'true' }, vars: { '--preview-color': theme.color, '--preview-bg': theme.background } },
        h('span', { class: 'theme-choice__mini-nav' }), h('span', { class: 'theme-choice__mini-card' }), h('span', { class: 'theme-choice__mini-action' })),
      h('b', { text: theme.name }), h('span', { class: 't-caption', text: theme.description }),
    )),
  );
  let drawer;
  drawer = openDrawer({ title: surface === 'console' ? '管理平台外观' : '活动平台外观', description: '选择即刻预览，下次打开时保留。两个平台可分别设置。', width: 540,
    body: [choices, h('label', { class: 'theme-motion' },
      h('input', { type: 'checkbox', checked: themeMotionEnabled(surface), on: { change: event => setThemeMotion(surface, event.target.checked) } }),
      h('span', { class: 'stack-1' }, h('b', { text: '交互动效' }), h('span', { class: 't-caption', text: '关闭后保持静态；系统的减少动态效果设置始终优先。' }))),
    ], footer: [button({ label: '完成', variant: 'primary', onClick: () => drawer.close() })] });
}
