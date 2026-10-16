import {h} from '../core/dom.js';

const motifs = {
  '主席团专项':'presidium',
  '博爱中心':'care',
  '生命中心':'life',
  '综事中心':'affairs',
  '一加助残专项':'access',
  '献血车专项':'blood',
};

// Inline paths make category identity available on first render, including when
// image requests fail. Shared 64-unit geometry keeps all six marks consistent.
const paths = {
  presidium: [
    'M27 14a5 5 0 1 0 10 0a5 5 0 1 0-10 0M22 29c0-7 4-10 10-10s10 3 10 10',
    'M9 37a5 5 0 1 0 10 0a5 5 0 1 0-10 0M5 54c0-8 3-12 9-12s9 4 9 12M45 37a5 5 0 1 0 10 0a5 5 0 1 0-10 0M41 54c0-8 3-12 9-12s9 4 9 12',
    'M32 30l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8-5.4 2.8 1-6-4.4-4.3 6.1-.9zM13 25l4-5M47 20l4 5M28 54h8',
  ],
  care: [
    'M32 31S18 23 18 16c0-8 10-10 14-3 4-7 14-5 14 3 0 7-14 15-14 15Z',
    'M23 56v-8L12 37 8 23c-1-4-6-3-5 2l3 17 12 14M23 48l-8-13c-3-4-7 0-4 4l6 8M41 56v-8l11-11 4-14c1-4 6-3 5 2l-3 17-12 14M41 48l8-13c3-4 7 0 4 4l-6 8',
  ],
  life: [
    'M11 22h27a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V27a5 5 0 0 1 5-5ZM18 22v-6a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v6',
    'M21 31h7v6h6v7h-6v6h-7v-6h-6v-7h6zM43 37h5l3-8 4 16 3-8h4',
  ],
  affairs: [
    'M34 52H13a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4h7M34 11h7a4 4 0 0 1 4 4v15M20 10h3a4 4 0 0 1 8 0h3v7H20zM18 32l5 5 12-12',
    'M43 35h6l1 4 4-1 3 5-3 3 3 3-3 5-4-1-1 4h-6l-1-4-4 1-3-5 3-3-3-3 3-5 4 1zM42 46a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  ],
  access: [
    'M22 13a5 5 0 1 0 10 0a5 5 0 1 0-10 0M26 23v14h13l9 16 8-5M26 29h12M20 28a15 15 0 1 0 18 24',
    'M48 28s-9-6-9-11c0-5 6-6 9-2 3-4 9-3 9 2 0 5-9 11-9 11Z',
  ],
  blood: [
    'M7 17h39c4 0 6 2 8 6l5 13v9h-7M17 45h24M7 45H4V22a5 5 0 0 1 3-5ZM10 45a5 5 0 1 0 10 0a5 5 0 1 0-10 0M42 45a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
    'M10 23h9v8h-9zM24 23h9v8h-9zM38 23h8l3 8H38zM53 36h6M30 36v8M26 40h8',
  ],
};

/** Decorative artwork; the category is already written beside the date tile. */
export function activityEmblem(category) {
  const motif=motifs[category];
  return motif?h('svg',{
    class:'activity-emblem activity-emblem--'+motif,viewBox:'0 0 64 64',
    'aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor',
    'stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round',
  },paths[motif].map(d=>h('path',{d}))):null;
}
