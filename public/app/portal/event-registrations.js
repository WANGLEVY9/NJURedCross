/** Prefer IDs; legacy responses require both the activity name and exact time. */
export function eventRegistrations(records,event) {
 const starts=[event.startAt,...(event.sessions||[]).map(session=>session.startAt)]
  .map(value=>Date.parse(value)).filter(Number.isFinite);
 return records.filter(record=>{
  if(record.eventId)return record.eventId===event.eventId;
  const start=Date.parse(record.startAt);
  return record.eventName===event.name&&Number.isFinite(start)&&starts.includes(start);
 });
}
