import {specialActivity,scheduleType} from './special-activity.js';
export const scheduledSession=event=>{const s=specialActivity(event);return Boolean(scheduleType(s?.type)&&s.rootId&&s.week);};
/** Same matrix interaction as blood shifts; explicit days and location/time rows. */
export function scheduleBoardLayout(events){
 if(!events.some(scheduledSession))return null;
 const days=[...new Set(events.map(e=>e['报名日期']))].sort(),locations=[...new Set(events.map(e=>e['地点']))];
 const periods=location=>[...new Set(events.filter(e=>e['地点']===location).map(e=>e['报名时段']))].sort();
 return {days,locations,periods,label:period=>Number(String(period).slice(0,2))<12?'上午':Number(String(period).slice(0,2))<18?'下午':'晚间',time:period=>String(period).replaceAll(':00-', '-').replace(/:00$/,'').replace('-', '–'),weekday:day=>['周日','周一','周二','周三','周四','周五','周六'][new Date(day+'T00:00:00Z').getUTCDay()]};
}
