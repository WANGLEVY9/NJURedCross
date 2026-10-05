import {h,clear} from '../core/dom.js';
import {button,badge,field} from '../ui/primitives.js';
export function weekStart(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export const shiftDay=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
export function bloodCalendar(events,registrations,onSelect,initialId=''){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 let week=weekStart(events.find(e=>e.id===initialId)?.date||events.find(e=>e.date>=today)?.date||events[0]?.date||today),day=events.find(e=>e.id===initialId)?.date||week,point='',selected=initialId;
 const grid=h('div',{class:'blood-calendar__grid'}),title=h('strong'),wrapper=h('section',{class:'blood-calendar stack-4','aria-label':'献血车周日历'});
 const points=[...new Set(events.map(e=>e.location))].sort();
 const filter=field({label:'点位',options:[{value:'',label:'全部点位'},...points.map(value=>({value,label:value}))],onInput:()=>{point=filter.control.value;draw();}});
 function draw(){
  title.textContent=`${week.replaceAll('-','/')} — ${shiftDay(week,6).slice(5).replace('-','/')}`;clear(grid);
  for(let i=0;i<7;i++){
   const date=shiftDay(week,i),items=events.filter(e=>e.date===date&&(!point||e.location===point)).sort((a,b)=>a.slot.localeCompare(b.slot)||a.location.localeCompare(b.location));
   const column=h('div',{class:'blood-calendar__day',data:{selected:date===day?'true':'false'}});
   column.append(h('button',{type:'button',class:'blood-calendar__date',aria:{pressed:String(date===day)},on:{click:()=>{day=date;draw();}}},h('span',{text:['周一','周二','周三','周四','周五','周六','周日'][i]}),h('b',{text:date.slice(5).replace('-','/')})));
   const slots=h('div',{class:'blood-calendar__slots'});
   for(const e of items){const own=registrations.find(r=>r.eventId===e.id),status=own?.result||(e.remaining===0?'已满':'可报名');slots.append(h('button',{type:'button',class:'blood-calendar__slot',data:{own:Boolean(own),active:selected===e.id},aria:{pressed:String(selected===e.id)},on:{click:()=>{selected=e.id;day=date;draw();onSelect(e);}}},badge(status,{tone:own?'accent':e.remaining===0?'neutral':'warning'}),h('strong',{text:e.location}),h('span',{text:e.slot}),h('small',{text:`剩余 ${e.remaining??e.capacity} / ${e.capacity}`})));}
   if(!items.length)slots.append(h('p',{class:'blood-calendar__empty',text:'暂无班次'}));column.append(slots);grid.append(column);
  }
 }
 wrapper.append(h('div',{class:'row-between row-wrap'},h('div',{class:'row-2 blood-calendar__toolbar'},button({label:'上周',variant:'secondary',size:'sm',onClick:()=>{week=shiftDay(week,-7);day=week;draw();}}),title,button({label:'下周',variant:'secondary',size:'sm',onClick:()=>{week=shiftDay(week,7);day=week;draw();}})),filter),grid);draw();return wrapper;
}
