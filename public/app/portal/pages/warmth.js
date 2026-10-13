import { birthdayAvailable } from '../warmth-rollout.js';
import { h } from '../../core/dom.js';
import { plazaHeader } from '../plaza-layout.js';
import { asyncRegion } from '../../console/lib.js';
import { notice } from '../../ui/primitives.js';
import { attachPageArt } from '../page-art.js';

/** Preserve main's existing flow until the production schema is ready. */
export default function page(...args) {
  let disposed = false, child;
  const region = asyncRegion({
    skeleton: h('div', { class: 'view plaza-page' }, h('div', { class: 'plaza-frame community-page' },
      plazaHeader({ label: '内建广场', title: '把温暖留给身边的同伴', description: '生日里的一封信，日常里的一声问候。', iconName: 'heart' }),
      notice('正在加载参与计划…', { tone: 'info' }))),
    load: async () => {
      const enabled = await birthdayAvailable();
      const module = await import(enabled ? './warmth-birthday.js' : './warmth-legacy.js');
      const result = await module.default(...args);
      if (disposed) result.dispose?.();
      else child = result;
      return result;
    },
    render: result => {
      if (disposed) return h('div');
      attachPageArt(result.node);
      return result.node;
    },
    errorTitle: '参与计划暂时无法加载',
  });
  return { title: '内建广场', node: region, dispose: () => { disposed = true; child?.dispose?.(); } };
}
