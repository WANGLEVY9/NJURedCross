import {h} from '../../core/dom.js';
import {openDrawer} from '../../ui/overlay.js';
import {request} from '../../core/api.js';
import {pageHead,button,field,notice} from '../../ui/primitives.js';
import {ACTIVITY_CATEGORY_OPTIONS} from '../../shared/activity-taxonomy.js';
import {calendarToday,calendarAddDays,calendarMonday,calendarEntries,calendarWeekLayout} from '../../shared/activity-calendar.js';
export default async function activityCalendar(){
 let anchor=calendarToday(),mode='month',events=[],disposed=false,busy=false,loaded=false,sequence=0;
 const node=h('div',{class:'view wspad wspad--wide activity-calendar stack-4'}),body=h('section',{class:'activity-calendar-board','aria-label':'活动日历'}),feedback=h('div',{'aria-live':'polite'}),stamp=h('span',{class:'t-caption',text:'正在读取活动…'}),title=h('h2',{class:'activity-calendar-title'});
 const category=field({label:'活动类别',options:[{value:'',label:'全部类别'},...ACTIVITY_CATEGORY_OPTIONS.map(value=>({value,label:value}))],onInput:()=>render()});
 const month=button({label:'月',onClick:()=>{mode='month';render();}}),week=button({label:'周',onClick:()=>{mode='week';render();}});
 function shift(direction){if(mode==='week')anchor=calendarAddDays(anchor,direction*7);else{const d=new Date(anchor.slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+direction);anchor=d.toISOString().slice(0,10);}render();}
 function card(item){return h('a',{class:'activity-calendar-card',href:'/console/events?event='+encodeURIComponent(item.id),data:{category:item.category},title:[item.name,item.time,item.location,item.status].join(' · ')},h('span',{class:'activity-calendar-card__time',text:item.time}),h('strong',{text:item.name}),h('span',{class:'activity-calendar-card__meta',text:item.status+(item.positions>1?' · '+item.positions+' 个岗位':'')}));}
 function render(){
  const today=calendarToday(),first=anchor.slice(0,7)+'-01',from=calendarMonday(mode==='month'?first:anchor);
  const next=new Date(first+'T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
  const last=calendarAddDays(next.toISOString().slice(0,10),-1),count=mode==='week'?7:Math.ceil((Math.round((Date.parse(last)-Date.parse(from))/86400000)+1)/7)*7,to=calendarAddDays(from,count-1);
  const entries=calendarEntries(events,calendarAddDays(from,-7),calendarAddDays(to,7)).filter(e=>!category.control.value||e.category===category.control.value);
  title.textContent=mode==='month'?anchor.slice(0,4)+' 年 '+Number(anchor.slice(5,7))+' 月':from+' — '+to;
  month.setAttribute('aria-pressed',String(mode==='month'));week.setAttribute('aria-pressed',String(mode==='week'));
  const grid=h('div',{class:'activity-calendar-grid activity-calendar-grid--spanning'+(mode==='week'?' activity-calendar-grid--week':''),role:'list','aria-label':mode==='month'?'月活动安排':'周活动安排'});
  for(let offset=0;offset<count;offset+=7){
   const monday=calendarAddDays(from,offset),{spans,singles}=calendarWeekLayout(entries,monday);
   const headings=h('div',{class:'activity-calendar-dates'}),days=h('div',{class:'activity-calendar-single-days'}),bars=h('div',{class:'activity-calendar-spans'});
   for(let i=0;i<7;i++){
    const date=calendarAddDays(monday,i),items=singles.filter(e=>e.date===date),all=entries.filter(e=>e.date===date);
    headings.append(h('div',{class:'activity-calendar-date-heading'+(date===today?' calendar-date-today':'')+(date.slice(0,7)!==anchor.slice(0,7)&&mode==='month'?' calendar-date-outside':'')},h('time',{datetime:date,text:Number(date.slice(8))}),date===today?h('span',{text:'今天'}):null));
    days.append(h('section',{class:'activity-calendar-day'+(date===today?' is-today':'')+(date.slice(0,7)!==anchor.slice(0,7)&&mode==='month'?' is-outside':''),role:'listitem','aria-label':date,data:{date}},...(mode==='month'?items.slice(0,3):items).map(card),...(mode==='month'&&items.length>3?[button({label:'另有 '+(items.length-3)+' 项活动',size:'sm',variant:'ghost',onClick:()=>openDrawer({title:date+' · 全部活动',body:h('div',{class:'stack-3'},...all.map(card))})})]:[]),...(!all.length&&mode==='week'?[h('span',{class:'activity-calendar-day__empty',text:'暂无活动'})]:[])));
   }
   for(const item of spans){
    const bar=card({...item,time:(item.continuesBefore?'← ':'')+item.start.slice(5)+' — '+item.end.slice(5)+(item.continuesAfter?' →':''),positions:0});
    bar.classList.add('activity-calendar-span','calendar-start-'+item.column,'calendar-length-'+item.length);
    bar.setAttribute('aria-label',item.name+'，'+item.actualStart+'至'+item.actualEnd);bars.append(bar);
   }
   grid.append(h('div',{class:'activity-calendar-week'},headings,...(spans.length?[bars]:[]),days));
  }
  body.replaceChildren(h('div',{class:'activity-calendar-scroll'},h('div',{class:'activity-calendar-weekdays'},...['周一','周二','周三','周四','周五','周六','周日'].map(text=>h('span',{text}))),grid));
  if(loaded&&entries.some(e=>e.date>=from&&e.date<=to))feedback.replaceChildren();
  if(loaded&&!entries.some(e=>e.date>=from&&e.date<=to))feedback.replaceChildren(notice('当前日期范围暂无符合条件的已审批活动。',{tone:'neutral'}));
 }
 async function load(){
  if(disposed||busy)return;busy=true;const current=++sequence;
  try{const data=await request('/api/volunteer/workflow/calendar',{fresh:true});if(disposed||current!==sequence)return;events=data.events||[];loaded=true;feedback.replaceChildren();stamp.textContent='已同步 · '+new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' · 每30秒自动更新';render();}
  catch(error){if(!disposed)feedback.replaceChildren(notice((loaded?'更新失败，保留上次结果。':'读取失败。')+(error.message||'请重试'),{tone:'warning'}));}finally{busy=false;}
 }
 const focus=()=>{if(!document.hidden)void load();};
 node.append(pageHead({title:'活动日历',description:'一眼查看每周安排，掌握已审批活动的时间与进展。',actions:[button({label:'刷新日历',onClick:load})]}),h('div',{class:'activity-calendar-toolbar'},h('div',{class:'row-2'},button({label:'上一'+(mode==='month'?'期':'周'),iconName:'chevronLeft',onClick:()=>shift(-1)}),button({label:'今天',onClick:()=>{anchor=calendarToday();render();}}),button({label:'下一期',iconName:'chevronRight',onClick:()=>shift(1)})),title,h('div',{class:'row-2'},month,week)),h('div',{class:'activity-calendar-filters row-between row-wrap'},category,stamp),feedback,body,h('div',{class:'activity-calendar-legend'},...ACTIVITY_CATEGORY_OPTIONS.map(text=>h('span',{class:'activity-calendar-legend__item',data:{category:text},text}))),h('p',{class:'t-caption',text:'展示权限范围内审批已通过的活动，点击卡片进入活动管理。献血车、成分献血及常态值班等常态化项目不纳入本日历。'}));
 render();void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 return {title:'活动日历',node,dispose:()=>{disposed=true;sequence++;clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);}};
}
