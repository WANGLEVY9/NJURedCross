/** Homepage seats exclude recurring programmes and open-ended registration limits. */
export function countPublicOpenSeats(events) {
  return events.reduce((sum,event)=>{
    if(event.status!=='报名中'||event.registrationOpen===false||event.longTerm||event.recurringDuty||event.registryType||event.blood)return sum;
    const remaining=Number(event.remaining);
    return sum+(Number.isFinite(remaining)&&remaining>0?remaining:0);
  },0);
}
