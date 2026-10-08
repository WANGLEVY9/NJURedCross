import {h,clear,icon} from '../core/dom.js';
import {button,badge,field,checkbox,iconButton} from '../ui/primitives.js';
import {openModal} from '../ui/overlay.js';
export function weekStart(date){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);}
export const shiftDay=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);

/** Most relevant own record on one shift: active standings outrank historical ones. */
function ownRegistration(registrations,eventId){
 const rows=registrations.filter(r=>r.eventId===eventId);
 if(!rows.length)return null;
 const rank=r=>['待筛选','已确认','已签到'].includes(r.status)?0:(r.status==='已请假'||r.leaveStatus==='待审批')?1:2;
 return rows.slice().sort((a,b)=>rank(a)-rank(b))[0];
}
/** Colour state per slot; a personal standing outranks plain capacity. */
function slotState(event,own){
 if(own){
  if(own.leaveStatus==='待审批')return{state:'leave',label:'请假待审批',tone:'warning'};
  if(own.result==='报名成功')return{state:'confirmed',label:'报名成功',tone:'success'};
  if(own.result==='已请假')return{state:'leave',label:'已请假',tone:'neutral'};
  if(own.result==='报名失败')return{state:'rejected',label:'报名失败',tone:'error'};
  return{state:'pending',label:'待确认',tone:'warning'};
 }
 return event.remaining===0?{state:'full',label:'已满',tone:'neutral'}:{state:'open',label:'可报名',tone:'accent'};
}
const LEGEND=[['open','可报名'],['full','已满'],['pending','待确认'],['confirmed','报名成功'],['leave','请假'],['rejected','报名失败']];

export function bloodCalendar(events,registrations,onSelect,initialId='',state={}){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const first=events.find(e=>e.id===initialId)||events.find(e=>e.date>=today&&e.remaining>0)||events.find(e=>e.date>=today)||events[0];
 let week=state.week||weekStart(first?.date||today),day=state.day||first?.date||week,point=state.point||'',selected=initialId,available=Boolean(state.available);

 const grid=h('div',{class:'blood-calendar__grid'}),wrapper=h('section',{class:'blood-calendar stack-4','aria-label':'献血车周日历'});
 const summary=h('p',{class:'blood-calendar__summary',aria:{live:'polite'}});
 const availability=checkbox({label:'仅看有名额',name:'available-slots',checked:available,onChange:value=>{available=value;draw();}});
 const points=[...new Set(events.map(e=>e.location))].sort();
 const filter=field({label:'点位',value:point,options:[{value:'',label:'全部点位'},...points.map(value=>({value,label:value}))],onInput:()=>{point=filter.control.value;draw();}});
 const titleText=h('span');
 const title=h('button',{type:'button',class:'blood-calendar__range',aria:{haspopup:'dialog'},on:{click:()=>openWeekPicker()}},titleText,icon('chevronDown','ico ico--sm'));
 const goWeek=target=>{week=weekStart(target);day=week;draw();};

 /** Month grid in a modal: one click on any day jumps straight to that week. */
 function openWeekPicker(){
  let month=week.slice(0,7);
  const monthLabel=h('strong',{class:'week-picker__month'});
  const grid=h('div',{class:'week-picker__grid'});
  function render(){
   monthLabel.textContent=`${month.slice(0,4)} 年 ${Number(month.slice(5))} 月`;
   const start=weekStart(`${month}-01`);
   const dows=['一','二','三','四','五','六','日'].map(label=>h('span',{class:'week-picker__dow',text:label}));
   const days=Array.from({length:42},(_,index)=>{
    const date=shiftDay(start,index);
    const dayEvents=events.filter(e=>e.date===date&&(!point||e.location===point));
    const shown=available?dayEvents.filter(e=>e.remaining>0):dayEvents;
    const allFull=!available&&dayEvents.length>0&&dayEvents.every(e=>e.remaining===0);
    return h('button',{type:'button',class:'week-picker__day',data:{inmonth:String(date.startsWith(month)),week:String(date>=week&&date<=shiftDay(week,6)),has:String(shown.length>0),full:String(allFull)},aria:{label:`${date}，${shown.length} 个班次`},on:{click:()=>{goWeek(date);modal.close();}}},h('span',{text:String(Number(date.slice(8)))}));
   });
   // Weekday header and day cells share one grid, so their columns cannot drift.
   grid.replaceChildren(...dows,...days);
  }
  const modal=openModal({title:'选择周次',width:420,body:h('div',{class:'week-picker'},h('div',{class:'week-picker__nav'},iconButton({iconName:'chevronLeft',label:'上一月',onClick:()=>{month=shiftDay(`${month}-01`,-1).slice(0,7);render();}}),monthLabel,iconButton({iconName:'chevronRight',label:'下一月',onClick:()=>{month=shiftDay(`${month}-01`,31).slice(0,7);render();}})),grid),footer:[button({label:'回到本周',variant:'primary',onClick:()=>{goWeek(today);modal.close();}}),h('span',{class:'spacer'}),button({label:'关闭',variant:'ghost',onClick:()=>modal.close()})]});
  render();
 }
 function draw(){
  Object.assign(state,{week,day,point,available});
  const weekEvents=events.filter(e=>e.date>=week&&e.date<=shiftDay(week,6)&&(!point||e.location===point));
  summary.textContent=`本周 ${weekEvents.length} 个班次 · 剩余 ${weekEvents.reduce((sum,e)=>sum+Number(e.remaining??e.capacity??0),0)} 个名额`;
  titleText.textContent=`${week.replaceAll('-','/')} — ${shiftDay(week,6).slice(5).replace('-','/')}`;
  clear(grid);
  for(let i=0;i<7;i++){
   const date=shiftDay(week,i),items=events.filter(e=>e.date===date&&(!point||e.location===point)&&(!available||e.remaining>0)).sort((a,b)=>a.slot.localeCompare(b.slot)||a.location.localeCompare(b.location));
   const column=h('div',{class:'blood-calendar__day',data:{selected:date===day?'true':'false'}});
   column.append(h('button',{type:'button',class:'blood-calendar__date',aria:{pressed:String(date===day)},on:{click:()=>{day=date;draw();}}},h('span',{text:['周一','周二','周三','周四','周五','周六','周日'][i]}),h('b',{text:date.slice(5).replace('-','/')})));
   const slots=h('div',{class:'blood-calendar__slots'});
   for(const e of items){
    const own=ownRegistration(registrations,e.id),info=slotState(e,own);
    slots.append(h('button',{type:'button',class:'blood-calendar__slot',data:{state:info.state,own:String(Boolean(own)),active:String(selected===e.id)},aria:{pressed:String(selected===e.id)},on:{click:()=>{selected=e.id;day=date;draw();onSelect(e);}}},
     badge(info.label,{tone:info.tone}),h('strong',{text:e.location}),h('span',{text:e.slot}),h('small',{text:`剩余 ${e.remaining??e.capacity} / ${e.capacity}`})));
   }
   if(!items.length)slots.append(h('p',{class:'blood-calendar__empty',text:available?'暂无可报名班次':'暂无班次'}));column.append(slots);grid.append(column);
  }
 }
 wrapper.append(h('div',{class:'blood-calendar__header'},h('div',{class:'row-2 blood-calendar__toolbar'},button({label:'上周',variant:'secondary',onClick:()=>goWeek(shiftDay(week,-7))}),title,button({label:'下周',variant:'secondary',onClick:()=>goWeek(shiftDay(week,7))}),button({label:'回到本周',variant:'secondary',onClick:()=>goWeek(today)})),h('div',{class:'row-3 row-wrap blood-calendar__filters'},filter,availability)),h('div',{class:'blood-calendar__legend',role:'list'},...LEGEND.map(([value,label])=>h('span',{class:'blood-calendar__legend-item',role:'listitem'},h('span',{class:'blood-calendar__legend-swatch',data:{state:value}}),h('span',{text:label})))),summary,grid);draw();return wrapper;
}
