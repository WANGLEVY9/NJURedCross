import {activityKind} from './activity-taxonomy.js';
export const calendarToday=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
export const calendarAddDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const calendarMonday=day=>calendarAddDays(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
const config=e=>{try{return JSON.parse(e['报名页配置']||'{}');}catch{return {};}};
/** Routine programmes stay in their dedicated boards, including dated generated shifts. */
export function calendarActivityAllowed(event){
 const c=config(event),category=activityKind({center:event['组织类别']||c.center,type:event['活动类别']});
 return !(c.longTerm||c.recurringDuty||c.blood||c.source?.kind==='generated_blood'||['province-service','component-donation'].includes(c.special?.type)||category==='献血车专项'||event['活动类别']==='献血车志愿服务');
}
export function calendarEntries(events,from,to){
 events=events.filter(calendarActivityAllowed);
 const parents=new Set(events.filter(e=>{const c=config(e);return (c.positionPlan?.positions||c.positionDraft?.positions)?.length;}).map(e=>e['活动ID']));
 const items=[];
 for(const e of events){
  const c=config(e);if(c.parentActivityId&&parents.has(c.parentActivityId)||c.longTerm&&!c.ordinary)continue;
  const positions=c.positionPlan?.positions||c.positionDraft?.positions;
  const spans=positions?.length?positions:[c.ordinary||c.window||{start:c.blood?.start||e['报名日期'],end:c.blood?.end||e['报名日期']}];
  const days=new Map();
  for(const span of spans){
   const start=String(span.start||'').slice(0,10),end=String(span.end||span.start||'').slice(0,10);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))continue;
   for(let date=start<from?from:start;date<=end&&date<=to;date=calendarAddDays(date,1)){
    if(!days.has(date))days.set(date,[]);days.get(date).push(span);
   }
  }
  for(const [date,spans]of days){
   const times=spans.map(p=>[String(p.start).slice(11,16),String(p.end).slice(11,16)]).filter(([a,b])=>a&&b);
   const time=times.length?[times.map(t=>t[0]).sort()[0],times.map(t=>t[1]).sort().at(-1)].join('–'):e['报名时段']||'时间待定';
   items.push({id:e._id,date,name:e['活动名称'],category:activityKind({center:e['组织类别']||c.center,type:e['活动类别']}),status:e['状态'],time:time==='00:00–23:59'?'全天':time,location:e['地点']||'',positions:spans.length});
  }
 }
 return items.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.name.localeCompare(b.name));
}

/** Merge consecutive dates by stable event identity; gaps and separate events stay separate. */
export function calendarWeekLayout(entries,monday){
 const groups=new Map(),runs=[];
 for(const item of entries){if(!groups.has(item.id))groups.set(item.id,[]);groups.get(item.id).push(item);}
 for(const items of groups.values()){
  items.sort((a,b)=>a.date.localeCompare(b.date));let run;
  for(const item of items){if(run&&calendarAddDays(run.end,1)===item.date){run.end=item.date;run.items.push(item);}else{run={...item,start:item.date,end:item.date,items:[item]};runs.push(run);}}
 }
 const sunday=calendarAddDays(monday,6),spans=runs.filter(r=>r.start!==r.end&&r.start<=sunday&&r.end>=monday).map(r=>{
  const start=r.start<monday?monday:r.start,end=r.end>sunday?sunday:r.end;
  return {...r,start,end,actualStart:r.start,actualEnd:r.end,column:Math.round((Date.parse(start)-Date.parse(monday))/86400000)+1,length:Math.round((Date.parse(end)-Date.parse(start))/86400000)+1,continuesBefore:r.start<monday,continuesAfter:r.end>sunday};
 }).sort((a,b)=>a.column-b.column||b.length-a.length||a.name.localeCompare(b.name));
 const singles=entries.filter(e=>e.date>=monday&&e.date<=sunday&&!spans.some(s=>s.id===e.id&&e.date>=s.start&&e.date<=s.end));
 return {spans,singles};
}
