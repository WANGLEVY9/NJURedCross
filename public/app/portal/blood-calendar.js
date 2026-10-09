import {bloodSlotState} from './blood-status.js';
import {h,clear,icon} from '../core/dom.js';
import {button,field,checkbox} from '../ui/primitives.js';
export function weekStart(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export const shiftDay=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
export function bloodCalendar(events,registrations,onSelect,initialId='',state={}){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const first=events.find(e=>e.id===initialId)||events.find(e=>e.date>=today&&e.remaining>0)||events.find(e=>e.date>=today)||events[0];
 let week=state.week||weekStart(first?.date||today),day=state.day||first?.date||week,point=state.point||'',selected=initialId,available=Boolean(state.available);

 const grid=h('div',{class:'blood-calendar__grid'}),title=h('strong'),wrapper=h('section',{class:'blood-calendar stack-4','aria-label':'献血车周日历'});
 const summary=h('p',{class:'blood-calendar__summary',aria:{live:'polite'}});
 const availability=checkbox({label:'仅看有名额',name:'available-slots',checked:available,onChange:value=>{available=value;draw();}});
 const points=[...new Set(events.map(e=>e.location))].sort();
 const filter=field({label:'点位',value:point,options:[{value:'',label:'全部点位'},...points.map(value=>({value,label:value}))],onInput:()=>{point=filter.control.value;draw();}});
 function draw(){
  Object.assign(state,{week,day,point,available});
  const weekEvents=events.filter(e=>e.date>=week&&e.date<=shiftDay(week,6)&&(!point||e.location===point));
  summary.textContent=`本周 ${weekEvents.length} 个班次 · 剩余 ${weekEvents.reduce((sum,e)=>sum+Number(e.remaining??e.capacity??0),0)} 个名额`;
  title.textContent=`${week.replaceAll('-','/')} — ${shiftDay(week,6).slice(5).replace('-','/')}`;clear(grid);
  for(let i=0;i<7;i++){
   const date=shiftDay(week,i),items=events.filter(e=>e.date===date&&(!point||e.location===point)&&(!available||e.remaining>0)).sort((a,b)=>a.slot.localeCompare(b.slot)||a.location.localeCompare(b.location));
   const column=h('div',{class:'blood-calendar__day',data:{selected:date===day?'true':'false'}});
   column.append(h('button',{type:'button',class:'blood-calendar__date',aria:{pressed:String(date===day)},on:{click:()=>{day=date;draw();}}},h('span',{text:['周一','周二','周三','周四','周五','周六','周日'][i]}),h('b',{text:date.slice(5).replace('-','/')})));
   const slots=h('div',{class:'blood-calendar__slots'});
   for(const e of items){
    const status=bloodSlotState(e,registrations),remaining=Number(e.remaining??e.capacity);
    slots.append(h('button',{type:'button',class:'blood-calendar__slot',data:{state:status.key,own:String(Boolean(status.own)),active:String(selected===e.id),full:String(remaining<=0)},aria:{pressed:String(selected===e.id),label:`${date} ${e.location} ${e.slot}，${status.label}，剩余${remaining}个名额`},on:{click:()=>{selected=e.id;day=date;draw();onSelect(e);}}},
     h('span',{class:'blood-slot-status'},icon(status.icon,'ico ico--sm'),h('span',{text:status.label})),
     h('strong',{text:e.location}),h('span',{class:'blood-calendar__time',text:e.slot}),
     h('small',{text:status.own?`总名额 ${e.capacity} 人`:remaining<=0?'可关注空位提醒':`剩余 ${remaining} / ${e.capacity} 个名额`})));
   }
   if(!items.length)slots.append(h('p',{class:'blood-calendar__empty',text:available?'暂无可报名班次':'暂无班次'}));column.append(slots);grid.append(column);
  }
 }
 wrapper.append(h('div',{class:'blood-calendar__header'},h('div',{class:'row-2 blood-calendar__toolbar'},button({label:'上周',variant:'secondary',onClick:()=>{week=shiftDay(week,-7);day=week;draw();}}),title,button({label:'下周',variant:'secondary',onClick:()=>{week=shiftDay(week,7);day=week;draw();}})),h('div',{class:'row-3 row-wrap blood-calendar__filters'},filter,availability)),summary,h('div',{class:'blood-calendar__legend','aria-label':'班次状态说明'},...['available','full','pending','confirmed'].map((key,i)=>h('span',{data:{state:key}},h('i'),h('span',{text:['可报名','已报满','我的待审核','我的报名成功'][i]})))),grid);draw();return wrapper;
}
