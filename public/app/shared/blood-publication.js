/** Public blood programme weeks use Monday–Sunday in Beijing time. */
export function bloodPublicWeek(status, now=Date.now()) {
  if(status!=='报名中')return null;
  const today=new Date(new Date(now).getTime()+8*3600000).toISOString().slice(0,10);
  const start=new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7+14);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}

