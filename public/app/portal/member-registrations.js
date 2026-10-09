/** Merge only the current account records returned by the two private APIs. */
export function memberRegistrations(ordinary = [], workflow = []) {
 const normalize=(item,source)=>{
  if(item.cancelledAt||['已取消','待取消','取消待审批','未入选','已请假','报名失败'].includes(item.status))return null;
  const checkedIn=Boolean(item.checkedInAt)||item.status==='已签到';
  const status=checkedIn?'已签到':['已确认','已报名','报名成功'].includes(item.status)?'已报名':['待筛选','待确认','候补'].includes(item.status)?'待确认':null;
  if(!status)return null;
  return {...item,source,status,waitlisted:item.status==='候补',
   eventName:item.eventName||'未命名活动',
   schedule:source==='workflow'?[item.date,item.slot].filter(Boolean).join(' '):'',
   href:source==='workflow'?(item.eventId?`/workflow-events?event=${encodeURIComponent(item.eventId)}`:'/workflow-events'):(item.code?`/status?code=${encodeURIComponent(item.code)}`:'/events'),
  };
 };
 return [...ordinary.map(item=>normalize(item,'ordinary')),...workflow.map(item=>normalize(item,'workflow'))]
  .filter(Boolean)
  .sort((a,b)=>String(b.submittedAt||b.startAt||b.date||'').localeCompare(String(a.submittedAt||a.startAt||a.date||'')));
}
