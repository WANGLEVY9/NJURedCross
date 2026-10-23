import {h,icon} from '../core/dom.js';
import {filterSegments} from '../ui/filter-segments.js';
import {badge} from '../ui/primitives.js';

/** Availability is supplied by the server; selection never decides eligibility. */
export function ordinarySessions(events,registrations,onSelect,selectedId){
 const dates=[...new Set(events.map(e=>e.date))].sort();
 let date=events.find(e=>e.id===selectedId)?.date||dates[0];
 const venues=h('div',{class:'ordinary-sessions__venues'});
 const navigation=filterSegments({items:dates.map(d=>({value:d,label:`${d.slice(5).replace('-','月')}日`})),value:date,ariaLabel:'选择服务日期',onChange:value=>{
  date=value;
  // Keep the detail in the visible date, without stealing keyboard focus.
  const next=events.find(e=>e.date===date&&e.id===selectedId)||events.find(e=>e.date===date);
  selectedId=next?.id;render();if(next)onSelect(next,{focus:false});
 }});
 navigation.classList.add('ordinary-sessions__dates');
 navigation.querySelectorAll('button').forEach((control,i)=>{
  const d=dates[i],dayEvents=events.filter(e=>e.date===d);
  const weekday=new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date(`${d}T12:00:00+08:00`));
  const available=dayEvents.some(e=>e.registrationOpen&&e.remaining>0);
  control.replaceChildren(h('strong',{text:`${d.slice(5).replace('-','月')}日`}),h('span',{text:weekday}),h('small',{text:available?'有可报名班次':'暂无可报名班次'}));
 });
 const cutoff=events[0]?.registrationEnd;
 const root=h('section',{class:'ordinary-sessions',id:'booking-sessions','aria-label':'普通活动班次安排'},
  h('header',{class:'ordinary-sessions__head'},h('div',{},h('h2',{text:events[0].name}),h('p',{text:'选择日期、服务地点与时段，安排你的下一次参与。'})),
   cutoff?h('p',{class:'ordinary-sessions__cutoff'},icon('clock'),h('span',{},'统一报名截止',h('strong',{text:cutoff.replace('T',' ').replace(':00+08:00','')}),h('small',{text:'北京时间'}))):null),navigation,venues);
 function render(){
  const dayEvents=events.filter(e=>e.date===date);
  venues.replaceChildren(...[...new Set(dayEvents.map(e=>e.location))].map(location=>{
   const entries=dayEvents.filter(e=>e.location===location).sort((a,b)=>String(a.ordinary?.start||a.slot).localeCompare(String(b.ordinary?.start||b.slot)));
   return h('section',{class:'ordinary-sessions__venue'},
    h('header',{},h('h3',{},icon('pin'),h('span',{text:location})),h('p',{text:`${entries.length} 个班次${entries[0].ordinary?.campus?` · ${entries[0].ordinary.campus}校区`:''}`})),
    ...entries.map(e=>{
     const own=registrations.some(r=>r.eventId===e.id&&['待筛选','已确认','已签到'].includes(r.status));
     const state=own?'registered':!e.registrationOpen?'closed':e.remaining===0?'full':'available';
     const label=own?'已报名':state==='closed'?'报名已关闭':state==='full'?'已满 · 可提醒':'可报名';
     const selected=e.id===selectedId;
     const position=e.position?.trim();
     return h('button',{class:'ordinary-sessions__slot',type:'button',data:{state,eventId:e.id},aria:{pressed:String(selected),label:`${e.date} ${location} ${e.slot}${position?` ${position}`:''}，${label}`},on:{click:()=>{selectedId=e.id;render();onSelect(e);}}},
      h('span',{class:'ordinary-sessions__time'},
       // 同一时段同一地点可能有多个岗位，卡片必须带上创建活动时的岗位名称。
       position?h('span',{class:'ordinary-sessions__position',text:position}):null,
       h('strong',{text:e.slot}),
       h('span',{text:e.quotaMode==='review'?`推荐录取 ${e.capacity} 人`:`剩余 ${e.remaining??'—'} / ${e.capacity??'—'} 名额`})),
      badge(label,{tone:own?'info':state==='available'?'success':'neutral',iconName:own?'check':state==='full'?'heart':state==='closed'?'lock':'calendar'}),
      h('span',{class:'ordinary-sessions__selected','aria-hidden':'true'},selected?icon('check'):icon('chevronRight')));
    }));
  }));
 }
 render();return root;
}
