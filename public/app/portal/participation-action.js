import {h,icon} from '../core/dom.js';

export function participationAction(title,subtitle,symbol,...body) {
 return h('details',{class:'participation-action',data:{action:title}},
  h('summary',{},h('span',{class:'participation-action__icon'},icon(symbol)),
   h('span',{class:'participation-action__label'},h('b',{text:title}),h('span',{text:subtitle})),icon('chevronDown','ico participation-action__chevron')),
  h('div',{class:'stack-3 participation-action__body'},...body));
}
