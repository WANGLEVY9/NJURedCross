import {h} from '../core/dom.js';

const motifs = {
  '主席团专项': {key:'presidium',path:'M12 52L32 20L52 52L72 20L92 52M20 60H84M32 20V10M72 20V10'},
  '博爱中心': {key:'care',path:'M52 58C36 48 16 34 22 20C28 7 45 12 52 23C59 12 76 7 82 20C88 34 68 48 52 58M10 59L26 63M78 63L94 59'},
  '生命中心': {key:'life',path:'M8 38H28L38 20L51 56L64 27L73 38H96M52 6V14M48 10H56'},
  '综事中心': {key:'affairs',path:'M18 15H46V39H18ZM58 15H86V39H58ZM30 50H74V62H30ZM32 39V50M72 39V50'},
  '一加助残专项': {key:'access',path:'M28 38H76M52 14V62M12 26C20 16 29 14 38 17M66 17C75 14 84 16 92 26M12 50C20 60 29 62 38 59M66 59C75 62 84 60 92 50'},
  '献血车专项': {key:'blood',path:'M12 22H65V52H12ZM65 31H80L92 43V52H65M26 52V60M78 52V60M32 29V45M24 37H40M4 32H12M2 43H12'},
};
export function activityEmblem(category) {
  const motif=motifs[category];
  if(!motif)return null;
  return h('svg',{class:`activity-emblem activity-emblem--${motif.key}`,viewBox:'0 0 104 72',fill:'none',stroke:'currentColor','stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'},h('path',{d:motif.path}));
}
