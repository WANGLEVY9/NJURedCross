import { h } from '../core/dom.js';

// Static, local artwork follows the section bounds, never the viewport or pointer.
const scenes = [
  ['.home-page', '.discovery-hero', 'home'],
  ['.event-browser--aligned', '.discovery-intro', 'directory'],
  ['.outreach-page', '.discovery-intro', 'editorial'],
  ['.community-page', '.community-heading', 'letter'],
  ['.member-page', '.discovery-intro', 'workspace'],
  ['.workflow-page', '.pagehead', 'calendar'],
];
export function attachPageArt(root) {
  for (const [page, selector, scene] of scenes) {
    if (!root.matches(page) && !root.querySelector(page)) continue;
    const host = root.querySelector(selector);
    if (!host || host.querySelector('.page-art')) return;
    host.dataset.artScene = scene;
    host.prepend(h('div', { class:'page-art', aria:{hidden:'true'} },
      h('span', { class:'page-art__plane' }),
      ...['dawn','sail','garden','iris','amber'].map(theme =>
        h('svg', { class:`page-art__ornament page-art__ornament--${theme}`, viewBox:'0 0 320 220', attrs:{focusable:'false'} },
          h('use', { href:`/assets/page-art/${theme}.svg#art` }))),
      h('span', { class:'page-art__axis' })));
    return;
  }
}
