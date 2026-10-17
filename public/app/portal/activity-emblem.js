import {h} from '../core/dom.js';

const motifs = {
  '主席团专项':'presidium',
  '博爱中心':'care',
  '生命中心':'life',
  '综事中心':'affairs',
  '一加助残专项':'access',
  '献血车专项':'blood',
};

/** Decorative artwork; the category is already written beside the date tile. */
export function activityEmblem(category) {
  const motif=motifs[category];
  return motif?h('i',{class:'activity-emblem-wrap','aria-hidden':'true'},h('span',{class:'activity-emblem activity-emblem--'+motif,'aria-hidden':'true'})):null;
}
