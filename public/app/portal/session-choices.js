import {h} from '../core/dom.js';
import {badge} from '../ui/primitives.js';
import * as fmt from '../core/format.js';

/** Native radios preserve keyboard/focus behavior without rebuilding the choices. */
export function sessionChoices(event, selectedId, onChange, name='event-session') {
 return h('fieldset',{class:'session-choices'},h('legend',{class:'field__label',text:'选择场次'}),
  ...event.sessions.map(session=>h('label',{class:'session-choice'},
   h('input',{type:'radio',name,value:session.sessionId,checked:session.sessionId===selectedId,on:{change:()=>onChange(session)}}),
   h('span',{class:'session-choice__copy'},h('b',{text:fmt.dateRange(session.startAt,session.endAt)}),h('span',{text:[session.location||event.location||'地点待公布',session.checkinMethod].filter(Boolean).join(' · ')})),
   session.full?badge('已满 · 可候补',{tone:'warning'}):badge(`剩 ${session.remaining}`,{tone:'success'}))));
}
