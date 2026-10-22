import {canonicalActivityCategory} from '../shared/activity-taxonomy.js';
import {h} from '../core/dom.js';

const motifs = {
  '主席团专项':'presidium',
  '博爱中心':'care',
  '生命中心':'life',
  '综事中心':'affairs',
  '排班专项':'schedule',
  '一加助残专项':'access',
  '献血车专项':'blood',
};

// Inline paths make category identity available on first render, including when
// image requests fail. Shared 64-unit geometry keeps all category marks consistent.
const paths = {
  presidium: [
    'M25 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 51V35a11 11 0 0 1 22 0v16',
    'M10 23a5 5 0 1 0 10 0a5 5 0 1 0-10 0M16 33h-1a9 9 0 0 0-9 9v9h10V40M44 23a5 5 0 1 0 10 0a5 5 0 1 0-10 0M48 33h1a9 9 0 0 1 9 9v9H48V40',
    'M32 45l3 6 6.6 1-4.8 4.6 1.2 6.5-6-3.1-6 3.1 1.2-6.5-4.8-4.6 6.6-1z',
  ],
  care: [
    'M32 31S18 23 18 16c0-8 10-10 14-3 4-7 14-5 14 3 0 7-14 15-14 15Z',
    'M23 56v-8L12 37 8 23c-1-4-6-3-5 2l3 17 12 14M23 48l-8-13c-3-4-7 0-4 4l6 8M41 56v-8l11-11 4-14c1-4 6-3 5 2l-3 17-12 14M41 48l8-13c3-4 7 0 4 4l-6 8',
  ],
  life: [
    'M14 20h36a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V26a6 6 0 0 1 6-6ZM23 20v-6a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v6',
    'M29 29h6v6h6v6h-6v6h-6v-6h-6v-6h6z',
  ],
  affairs: [
    'M34 52H13a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4h7M34 11h7a4 4 0 0 1 4 4v15M20 10h3a4 4 0 0 1 8 0h3v7H20zM18 32l5 5 12-12',
    'M43 35h6l1 4 4-1 3 5-3 3 3 3-3 5-4-1-1 4h-6l-1-4-4 1-3-5 3-3-3-3 3-5 4 1zM42 46a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  ],
  schedule: [
    'M32 53H12a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5h33a5 5 0 0 1 5 5v10M17 7v11M39 7v11M7 24h43',
    'M17 33h4M28 33h4M17 42h4M28 42h3',
    'M45 32a13 13 0 1 0 0 26a13 13 0 1 0 0-26M45 37v8l5 3',
  ],
  access: [
    'M22 13a5 5 0 1 0 10 0a5 5 0 1 0-10 0M26 23v14h13l9 16 8-5M26 29h12M20 28a15 15 0 1 0 18 24',
    'M48 28s-9-6-9-11c0-5 6-6 9-2 3-4 9-3 9 2 0 5-9 11-9 11Z',
  ],
  blood: [
    'M10 6h32c5 0 8 3 10 8l6 13v23h-8M24 50h20M10 50H6V10a4 4 0 0 1 4-4M14 50a5 5 0 1 0 10 0a5 5 0 1 0-10 0M44 50a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
    'M12 14h11v10H12zM27 14h11v10H27zM42 14h8l4 9H42zM26 32h10v18M54 40h4M30 36v6M26 42h8',
  ],
};

/** Decorative artwork; the category is already written beside the date tile. */
export function activityEmblem(category) {
  const motif=motifs[canonicalActivityCategory(category)];
  return motif?h('svg',{
    class:'activity-emblem activity-emblem--'+motif,viewBox:'0 0 64 64',
    'aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor',
    'stroke-width':2.3,'stroke-linecap':'round','stroke-linejoin':'round',
  },paths[motif].map((d,index)=>h('path',{d,fill:(motif==='presidium'&&index===2)||(motif==='life'&&index===1)?'currentColor':'none'}))):null;
}
