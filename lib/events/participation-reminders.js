import {createHash} from 'node:crypto';
import {sessionWindow} from './ordinary-groups.js';
import {shanghaiInstant} from '../../public/app/shared/activity-window.js';
import {mailSettingsSnapshot,eventMailVariables} from '../mail/templates.js';
export function participationReminderMessages(events,registrations,origin,now=Date.now()){
 const time=mailSettingsSnapshot().defaults.reminderTime,messages=[];
 for(const row of registrations){
  if(row['报名状态']!=='已确认'||![true,'true'].includes(row['是否报名成功'])||['待审批','已批准'].includes(row['请假状态']))continue;
  const event=events.find(e=>e['活动ID']===row['活动ID']);if(!event||event['状态']!=='报名中')continue;
  let c;try{c=JSON.parse(event['报名页配置']||'{}');}catch{continue;}
  if(c.rosterReview?.phase==='publishing')continue;
  if(c.workspaceRemoval)continue;
  const window=sessionWindow(event),slot=String(row['报名时段']||event['报名时段']||''),match=/(\d{1,2}):(\d{2})/.exec(slot)||/(\d{1,2})\s*[~～-]/.exec(slot);
  let hour=match?Number(match[1]):NaN;if(/下午|晚上/.test(slot)&&hour<12)hour+=12;
  const start=shanghaiInstant(window?.start||`${row['报名日期']||event['报名日期']}T${c.startTime||`${String(hour).padStart(2,'0')}:${match?.[2]||'00'}`}`);
  if(!start)continue;
  const due=Date.parse(start.local.slice(0,10)+'T'+time+':00+08:00')-86400000;
  if(now<due||now>=start.timestamp)continue;
  if(!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(row['邮箱']||'')||row['邮箱'].split('@')[0]!==row['学号'])continue;
  const hash=createHash('sha256').update(JSON.stringify([row['报名ID'],event['活动ID'],start.canonical,time])).digest('hex');
  messages.push({to:row['邮箱'],subject:'活动参与提醒',text:'活动参与提醒',kind:'workflow-result',templateId:'participation-reminder',templateVariables:{...eventMailVariables(event,row,origin),'日期':start.local.slice(0,10),'时段':event['报名时段']||row['报名时段']||''},startAt:start.canonical,idempotencyKey:'PARTICIPATION:'+hash,registrationId:row._id});
 }
 return messages;
}
