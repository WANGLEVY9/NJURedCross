import {h,icon} from '../core/dom.js';
import {filterSegments} from '../ui/filter-segments.js';
import {button,badge,notice} from '../ui/primitives.js';

/** Two-date/two-venue board: native buttons, stable date selection, no fake availability. */
export function ordinarySessions(events,registrations,onSelect,selectedId){
 const dates=[...new Set(events.map(e=>e.date))].sort();
 let date=events.find(e=>e.id===selectedId)?.date||dates[0];
 const slot=h('div',{class:'ordinary-sessions__venues'});
 const root=h('section',{class:'ordinary-sessions','aria-label':'普通活动班次安排'},h('header',{class:'ordinary-sessions__head'},h('h2',{text:events[0].name}),h('p',{class:'t-secondary',text:'选择日期与服务点位，可分别报名多个不重叠的班次。'}),h('p',{class:'t-caption',text:`统一报名截止：${events[0].registrationEnd?.replace('T',' ').replace(':00+08:00','')}（北京时间）`}),notice('取消报名须填写原因并经管理员审核；时长规则待确定，不自动计算志愿时长。',{tone:'neutral'})),filterSegments({items:dates.map(d=>({value:d,label:`${d.slice(5).replace('-','月')}日`})),value:date,ariaLabel:'选择服务日期',onChange:value=>{date=value;render();}}),slot);
 function render(){
  slot.replaceChildren(...[...new Set(events.filter(e=>e.date===date).map(e=>e.location))].map(location=>h('section',{class:'ordinary-sessions__venue'},h('h3',{},icon('pin','ico ico--sm'),h('span',{text:location})),...events.filter(e=>e.date===date&&e.location===location).sort((a,b)=>a.ordinary.start.localeCompare(b.ordinary.start)).map(e=>{
   const own=registrations.find(r=>r.eventId===e.id&&['待筛选','已确认','已签到'].includes(r.status));
   const label=own?'已报名':!e.registrationOpen?'报名已关闭':e.remaining===0?'已满 · 可提醒':`剩余 ${e.remaining} / ${e.capacity}`;
   return button({label:e.slot,variant:'secondary',onClick:()=>{selectedId=e.id;render();onSelect(e);},ariaLabel:`${e.date} ${location} ${e.slot}，${label}`});
  }).map((control,index)=>{
   const e=events.filter(e=>e.date===date&&e.location===location).sort((a,b)=>a.ordinary.start.localeCompare(b.ordinary.start))[index];
   const own=registrations.find(r=>r.eventId===e.id&&['待筛选','已确认','已签到'].includes(r.status));
   control.classList.add('ordinary-sessions__slot');control.setAttribute('aria-pressed',String(e.id===selectedId));
   control.append(badge(own?'已报名':!e.registrationOpen?'已关闭':e.remaining===0?'已满 · 可提醒':`剩 ${e.remaining} / ${e.capacity}`,{tone:own?'info':!e.registrationOpen||!e.remaining?'neutral':'success'}));return control;
  }))));
 }
 render();return root;
}
