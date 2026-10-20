import {activityWindow,shanghaiInstant} from '../../public/app/shared/activity-window.js';
import {workflowConfig} from './blood-roster.js';
const display=instant=>instant.local.slice(0,instant.local.endsWith(':00')?16:19).replace('T',' ');

/** Planned work window only; reviewers confirm actual work and travel separately. */
export function finalHoursDates(job,registration){
 const config=workflowConfig(job),window=config.ordinary||config.window;
 if(activityWindow(window?.start,window?.end)){
  const start=shanghaiInstant(window.start),end=shanghaiInstant(window.end);
  return start.local.slice(0,10)===end.local.slice(0,10)?`${display(start)}—${display(end).slice(11)}`:`${display(start)} — ${display(end)}`;
 }
 const date=String(registration['报名日期']||job['报名日期']||'').trim(),slot=String(registration['报名时段']||job['报名时段']||'').trim();
 return date&&slot.includes(date)?slot:[date,slot].filter(Boolean).join(' ');
}
