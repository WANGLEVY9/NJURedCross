import {h,icon} from '../core/dom.js';
import {activityFacts,badge,statusIndicator} from '../ui/primitives.js';
import * as fmt from '../core/format.js';

export const isClosedActivity = event => ['进行中','已结束'].includes(event?.status);

/** Public information only: no participant identity, booking controls or records. */
export function closedActivityPage(event) {
  const sessions=event.sessions||[];
  return {title:event.name,node:h('div',{class:'view ordinary-event-detail closed-activity-detail'},
    h('header',{class:'pdetail__hero event-editorial-heading'},
      h('a',{class:'t-caption t-muted row-2',href:'/events'},icon('chevronLeft','ico ico--sm'),h('span',{text:'返回活动广场'})),
      h('div',{class:'row-3 row-wrap'},badge(event.type||'公益活动',{tone:'accent'}),statusIndicator(event.status,{tone:event.status==='进行中'?'info':'idle'})),
      h('h1',{class:'t-display',text:event.name})),
    h('div',{class:'stack-5'},
      activityFacts([
        {label:'活动时间',value:fmt.dateRange(event.startAt,event.endAt)||event.schedule||'待公布',iconName:'calendar'},
        {label:'活动地点',value:[event.campus,event.location].filter(Boolean).join(' · ')||'待公布',iconName:'pin'},
      ]),
      event.description?h('section',{class:'event-editorial-copy'},h('h2',{class:'t-h2',text:'活动介绍'}),h('p',{class:'t-prose workflow-copy',text:event.description})):null,
      sessions.length?h('section',{class:'stack-4'},h('h2',{class:'t-h2',text:'场次安排'}),...sessions.map(session=>h('article',{class:'panel'},h('div',{class:'panel__body'},activityFacts([
        {label:'时间',value:fmt.dateRange(session.startAt,session.endAt),iconName:'calendar'},
        {label:'地点',value:session.location||event.location||'待公布',iconName:'pin'},
      ]))))):null))};
}
