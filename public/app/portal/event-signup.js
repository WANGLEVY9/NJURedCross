/** Shared signup action for ordinary activities and workflow shifts. */
export function eventSignupState(event, registrations = []) {
 const id=event.eventId||event.id;
 const registered=registrations.some(row=>row.eventId===id&&['待筛选','待确认','已确认','已签到','候补'].includes(row.status));
 if(registered)return {label:'已报名',disabled:true};
 const full=event.full===true||(Number(event.capacity)>0&&event.remaining!=null&&Number(event.remaining)<=0);
 if(full)return {label:'已报满',disabled:true};
 return {label:'我要报名',disabled:false};
}
