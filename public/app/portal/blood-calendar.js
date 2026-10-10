import {bloodSlotState} from './blood-status.js';
import {h,clear,icon} from '../core/dom.js';
import {prefersReducedMotion} from '../core/motion.js';
import {button} from '../ui/primitives.js';
import {filterSegments} from '../ui/filter-segments.js';
import {BLOOD_POINTS} from '../shared/blood-points.js';
export function weekStart(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export const shiftDay=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
export function bloodCalendar(events,registrations,onSelect,initialId='',state={}){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const first=events.find(e=>e.id===initialId)||events.find(e=>e.date>=today&&e.remaining>0)||events.find(e=>e.date>=today)||events[0];
 let week=state.week||weekStart(first?.date||today),day=state.day||first?.date||week,point=state.point||'',selected=initialId,available=Boolean(state.available),animation;
 const remaining=e=>Number(e.remaining??e.capacity??0);
 const grid=h('div',{class:'blood-calendar__grid'}),title=h('strong'),month=h('span',{class:'blood-calendar__month'});
 const wrapper=h('section',{class:'blood-calendar','aria-label':'献血车周日历'});
 wrapper.dataset.density=state.density==='compact'?'compact':'comfortable';
 const density=filterSegments({ariaLabel:'日历显示密度',items:[{value:'comfortable',label:'舒展'},{value:'compact',label:'紧凑'}],value:wrapper.dataset.density,onChange:value=>{state.density=value;wrapper.dataset.density=value;}});
 const summary=h('p',{class:'blood-calendar__summary',role:'status',aria:{live:'polite',atomic:'true'}});
 const reset=button({label:'重置筛选',variant:'ghost',size:'sm',onClick:()=>{point='';available=false;filter.setValue('');availability.setValue('all');draw(true);filter.querySelector('button').focus();}});
 const availability=filterSegments({ariaLabel:'名额筛选',items:[{value:'all',label:'全部班次'},{value:'available',label:'仅看有名额'}],value:available?'available':'all',onChange:value=>{available=value==='available';draw(true);}});
 const points=[...new Set([...BLOOD_POINTS,...events.map(e=>e.location).filter(Boolean)])];
 const filter=filterSegments({ariaLabel:'点位筛选',items:[{value:'',label:'全部点位'},...points.map(value=>({value,label:value,compactLabel:value.replace(/^(新街口|仙林|浦口)/,'$1\n')}))],value:point,onChange:value=>{point=value;draw(true);}});
 const filterGroup=(label,control)=>h('div',{class:'blood-calendar__filter-group'},h('p',{class:'field__label',text:label}),control);
 const emptyHint=h('p',{class:'blood-calendar__empty-hint',hidden:true});
 function draw(reconcile=false){
  const focusedDate=document.activeElement?.dataset?.date;
  const weekEvents=events.filter(e=>e.date>=week&&e.date<=shiftDay(week,6)&&(!point||e.location===point));
  const shown=weekEvents.filter(e=>!available||remaining(e)>0);
  // A filter should reveal a matching day on phones, not leave results hidden on another day.
  if(reconcile&&shown.length&&!shown.some(e=>e.date===day))day=[...shown].sort((a,b)=>a.date.localeCompare(b.date))[0].date;
  Object.assign(state,{week,day,point,available});
  reset.hidden=!point&&!available;
  summary.textContent=`${point||'全部点位'} · 本周显示 ${shown.length} 个班次 · 剩余 ${shown.reduce((sum,e)=>sum+remaining(e),0)} 个名额`;
  emptyHint.hidden=shown.length>0;
  emptyHint.textContent=weekEvents.length?'本周符合筛选条件的班次已报满，可切换“全部班次”查看，或选择其他周次。':point?`${point}本周暂无排班，可切换周次或查看其他点位。`:'本周暂无排班，可切换周次查看。';
  month.textContent=`${week.slice(0,4)} 年 ${Number(week.slice(5,7))} 月`;
  title.textContent=`${week.replaceAll('-','/')} — ${shiftDay(week,6).slice(5).replace('-','/')}`;
  clear(grid);
  for(let i=0;i<7;i++){
   const date=shiftDay(week,i),items=shown.filter(e=>e.date===date).sort((a,b)=>a.slot.localeCompare(b.slot)||a.location.localeCompare(b.location));
   const column=h('div',{class:'blood-calendar__day',data:{selected:String(date===day),empty:String(!items.length)}});
   const name=['周一','周二','周三','周四','周五','周六','周日'][i];
   column.append(h('button',{type:'button',class:'blood-calendar__date',data:{date,today:String(date===today)},aria:{pressed:String(date===day),label:`${name} ${date.slice(5).replace('-','/')}`},on:{click:()=>{day=date;draw();grid.querySelector(`[data-date="${date}"]`).focus({preventScroll:true});}}},h('span',{text:name}),h('b',{text:date.slice(8)}),h('small',{text:items.length?`${items.length} 班`:'—',aria:{hidden:'true'}})));
   const slots=h('div',{class:'blood-calendar__slots'});
   for(const e of items){
    const status=bloodSlotState(e,registrations),seats=remaining(e);
    slots.append(h('button',{type:'button',class:'blood-calendar__slot',data:{eventId:e.id,state:status.key,own:String(Boolean(status.own)),active:String(selected===e.id),full:String(seats<=0)},aria:{pressed:String(selected===e.id),label:`${date} ${e.location} ${e.slot}，${status.label}，剩余${seats}个名额`},on:{click:()=>{selected=e.id;day=date;draw();onSelect(e);}}},
     h('span',{class:'blood-slot-top'},h('span',{class:'blood-slot-status'},icon(status.icon,'ico ico--sm'),h('span',{text:status.label.replace('我的 · ','')}))),
     h('strong',{class:'blood-slot-location',text:e.location}),h('strong',{class:'blood-calendar__time',text:e.slot}),
     h('span',{class:'blood-slot-bottom'},h('span',{class:'blood-slot-capacity',title:'剩余 / 总名额'},h('b',{text:String(seats)}),h('span',{text:` / ${e.capacity} 名额`})),icon('arrowRight','ico ico--sm'))));
   }
   if(!items.length)slots.append(h('p',{class:'blood-calendar__empty'},icon('calendar','ico'),h('span',{text:available?'当天暂无可报名班次':'当天暂无班次'})));
   column.append(slots);grid.append(column);
  }
  if(focusedDate)grid.querySelector(`[data-date="${focusedDate}"]`)?.focus({preventScroll:true});
  animation?.cancel();
  if(reconcile&&!prefersReducedMotion()&&!wrapper.querySelector('.filter-segments--keyboard'))animation=grid.animate([{opacity:.55,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});
 }
 grid.addEventListener('keydown',event=>{
  const control=event.target.closest('.blood-calendar__date');
  if(!control||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const dates=[...grid.querySelectorAll('.blood-calendar__date')],index=dates.indexOf(control);
  const next=event.key==='Home'?0:event.key==='End'?6:Math.max(0,Math.min(6,index+(event.key==='ArrowLeft'?-1:1)));
  dates[next].click();
 });
 const changeWeek=offset=>{week=shiftDay(week,offset);day=week;draw(true);};
 wrapper.append(
  h('div',{class:'blood-calendar__header'},
   h('div',{class:'blood-calendar__heading'},h('div',{class:'blood-calendar__period'},month,title),h('div',{class:'blood-calendar__toolbar'},button({label:'上周',iconName:'chevronLeft',variant:'secondary',onClick:()=>changeWeek(-7)}),button({label:'下周',iconAfter:'chevronRight',variant:'secondary',onClick:()=>changeWeek(7)}))),
   h('div',{class:'blood-calendar__filters'},filterGroup('服务点位',filter),filterGroup('可报名名额',availability))),
  h('div',{class:'blood-calendar__result'},summary,h('div',{class:'blood-calendar__display'},h('div',{class:'blood-calendar__density'},density),reset)),emptyHint,grid,
  h('div',{class:'blood-calendar__legend','aria-label':'班次状态说明'},...['available','full','pending','confirmed'].map((key,i)=>h('span',{data:{state:key}},h('i'),h('span',{text:['可报名','已报满','我的待审核','我的报名成功'][i]})))));
 draw();return wrapper;
}
