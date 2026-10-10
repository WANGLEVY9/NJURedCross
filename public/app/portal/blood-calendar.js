import {bloodSlotState} from './blood-status.js';
import {h,clear,icon} from '../core/dom.js';
import {button} from '../ui/primitives.js';
import {filterSegments} from '../ui/filter-segments.js';
import {BLOOD_POINTS} from '../shared/blood-points.js';
export function weekStart(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export const shiftDay=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
export function bloodCalendar(events,registrations,onSelect,initialId='',state={}){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const first=events.find(e=>e.id===initialId)||events.find(e=>e.date>=today&&e.remaining>0)||events.find(e=>e.date>=today)||events[0];
 let week=state.week||weekStart(first?.date||today),day=state.day||first?.date||week,point=state.point||'',selected=initialId,available=Boolean(state.available);

 const grid=h('div',{class:'blood-calendar__grid'}),title=h('strong'),wrapper=h('section',{class:'blood-calendar stack-4','aria-label':'献血车周日历'});
 const summary=h('p',{class:'blood-calendar__summary',aria:{live:'polite'}});
 const availability=filterSegments({ariaLabel:'名额筛选',items:[{value:'all',label:'全部班次'},{value:'available',label:'仅看有名额'}],value:available?'available':'all',onChange:value=>{available=value==='available';draw();}});
 const points=[...new Set([...BLOOD_POINTS,...events.map(e=>e.location).filter(Boolean)])];
 const filter=filterSegments({ariaLabel:'点位筛选',items:[{value:'',label:'全部点位'},...points.map(value=>({value,label:value,compactLabel:value.replace(/^(新街口|仙林|浦口)/,'$1\n')}))],value:point,onChange:value=>{point=value;draw();}});
 const filterGroup=(label,control)=>h('div',{class:'blood-calendar__filter-group'},h('p',{class:'field__label',text:label}),control);
 const emptyHint=h('p',{class:'blood-calendar__empty-hint',aria:{live:'polite'},hidden:true});
 function draw(){
  Object.assign(state,{week,day,point,available});
  const weekEvents=events.filter(e=>e.date>=week&&e.date<=shiftDay(week,6)&&(!point||e.location===point));
  summary.textContent=`本周 ${weekEvents.length} 个班次 · 剩余 ${weekEvents.reduce((sum,e)=>sum+Number(e.remaining??e.capacity??0),0)} 个名额`;
  emptyHint.hidden=weekEvents.length>0;
  emptyHint.textContent=point?`${point}本周暂无排班，班次以 NJUTable 排班表更新为准。可切换周次或查看其他点位。`:'本周暂无排班，可切换周次查看。';
  title.textContent=`${week.replaceAll('-','/')} — ${shiftDay(week,6).slice(5).replace('-','/')}`;clear(grid);
  for(let i=0;i<7;i++){
   const date=shiftDay(week,i),items=events.filter(e=>e.date===date&&(!point||e.location===point)&&(!available||e.remaining>0)).sort((a,b)=>a.slot.localeCompare(b.slot)||a.location.localeCompare(b.location));
   const column=h('div',{class:'blood-calendar__day',data:{selected:date===day?'true':'false'}});
   column.append(h('button',{type:'button',class:'blood-calendar__date',aria:{pressed:String(date===day)},on:{click:()=>{day=date;draw();}}},h('span',{text:['周一','周二','周三','周四','周五','周六','周日'][i]}),h('b',{text:date.slice(5).replace('-','/')})));
   const slots=h('div',{class:'blood-calendar__slots'});
   for(const e of items){
    const status=bloodSlotState(e,registrations),remaining=Number(e.remaining??e.capacity);
    slots.append(h('button',{type:'button',class:'blood-calendar__slot',data:{state:status.key,own:String(Boolean(status.own)),active:String(selected===e.id),full:String(remaining<=0)},aria:{pressed:String(selected===e.id),label:`${date} ${e.location} ${e.slot}，${status.label}，剩余${remaining}个名额`},on:{click:()=>{selected=e.id;day=date;draw();onSelect(e);}}},
     h('span',{class:'blood-slot-top'},h('span',{class:'blood-slot-status'},icon(status.icon,'ico ico--sm'),h('span',{text:status.label.replace('我的 · ','')})),h('span',{class:'blood-slot-capacity',text:`${remaining}/${e.capacity}`,title:'剩余 / 总名额'})),
     h('strong',{text:e.location}),h('strong',{class:'blood-calendar__time',text:e.slot})));

   }
   if(!items.length)slots.append(h('p',{class:'blood-calendar__empty',text:available?'暂无可报名班次':'暂无班次'}));column.append(slots);grid.append(column);
  }
 }
 wrapper.append(h('div',{class:'blood-calendar__header'},h('div',{class:'row-2 blood-calendar__toolbar'},button({label:'上周',variant:'secondary',onClick:()=>{week=shiftDay(week,-7);day=week;draw();}}),title,button({label:'下周',variant:'secondary',onClick:()=>{week=shiftDay(week,7);day=week;draw();}})),h('div',{class:'blood-calendar__filters'},filterGroup('点位',filter),filterGroup('名额',availability))),summary,emptyHint,h('div',{class:'blood-calendar__legend','aria-label':'班次状态说明'},...['available','full','pending','confirmed'].map((key,i)=>h('span',{data:{state:key}},h('i'),h('span',{text:['可报名','已报满','我的待审核','我的报名成功'][i]})))),grid);draw();return wrapper;
}
