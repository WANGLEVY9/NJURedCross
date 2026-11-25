import {DatabaseSync} from 'node:sqlite';
import {observer} from '../observability.js';
import {workflowConfig} from './blood-roster.js';
import {attendanceBounds} from './attendance-window.js';
import {ACTIVITY_FEEDBACK_TEMPLATES,validFeedbackTemplate} from '../../public/app/shared/activity-feedback.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});

export function feedbackTemplate(event,project){
 const override=workflowConfig(event).feedbackTemplate||workflowConfig(project||{}).feedbackTemplate;
 if(validFeedbackTemplate(override))return override;
 const tags=[event['活动类别'],event['组织类别'],project?.['活动类别'],project?.['组织类别']].filter(Boolean).join(' ');
 if(/青年参与|国际人道法|探索人道法|\bIHL\b/i.test(`${tags} ${event['活动名称']||''}`))return 'ihl';
 return /总结|实践/.test(tags)?'summary':'rating';
}

export function feedbackEligible(event,row,account,now=Date.now()){
 if(!event||account.emailVerified!==true||!row['报名ID']||!row['签到行ID']||row['报名状态']!=='已签到'||
    ![true,'true'].includes(row['是否报名成功'])||row['请假状态']==='已批准'||event.bloodAbsences?.[row._id])return false;
 if(!['报名中','进行中','停点','已结束','已归档'].includes(event['状态']))return false;
 const config=workflowConfig(event);
 const end=config.endTime&&!config.window&&!config.ordinary&&!config.blood
  ?Date.parse(`${config.endDate||event['报名日期']}T${config.endTime}:00+08:00`):attendanceBounds(event).end;
 return Number.isFinite(end)&&now>=end&&(row['账号ID']===account.accountId||
   Boolean(account.studentId&&account.realName&&row['账号ID']===`manual:${account.studentId}`&&row['学号']===account.studentId&&row['姓名']===account.realName));
}

export function createActivityFeedbackStore(path,{now=Date.now}={}){
 const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE IF NOT EXISTS 活动反馈表 (
  活动ID TEXT NOT NULL, 报名行ID TEXT PRIMARY KEY, 账号ID TEXT NOT NULL, 学号 TEXT NOT NULL, 姓名 TEXT NOT NULL,
  模板类型 TEXT NOT NULL, 评分 INTEGER, 正文 TEXT NOT NULL, 提交时间 TEXT NOT NULL, 修改时间 TEXT NOT NULL, 版本 INTEGER NOT NULL
 ); CREATE INDEX IF NOT EXISTS activity_feedback_account ON 活动反馈表(账号ID);
 CREATE INDEX IF NOT EXISTS activity_feedback_event ON 活动反馈表(活动ID,提交时间);
 CREATE TABLE IF NOT EXISTS activity_feedback_read (feedback_id TEXT, account_id TEXT, PRIMARY KEY(feedback_id,account_id));
 CREATE TABLE IF NOT EXISTS activity_feedback_outbox (feedback_id TEXT PRIMARY KEY, next_at INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS activity_feedback_delivery (delivery_key TEXT PRIMARY KEY);
 CREATE TRIGGER IF NOT EXISTS activity_feedback_enqueue AFTER INSERT ON 活动反馈表 BEGIN
   INSERT INTO activity_feedback_outbox (feedback_id) VALUES (new.报名行ID);
 END;`);
 const find=db.prepare('SELECT * FROM 活动反馈表 WHERE 报名行ID=?');
 const submitted=db.prepare('SELECT 报名行ID FROM 活动反馈表 WHERE 账号ID=?');
 const insert=db.prepare('INSERT INTO 活动反馈表 VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(报名行ID) DO NOTHING');
 const update=db.prepare('UPDATE 活动反馈表 SET 评分=?,正文=?,修改时间=?,版本=版本+1 WHERE 报名行ID=? AND 账号ID=? AND 版本=?');
 const findEvents=db.prepare('SELECT DISTINCT 活动ID FROM 活动反馈表');
 const list=db.prepare(`SELECT f.*, r.account_id IS NOT NULL AS reviewed FROM 活动反馈表 f
  LEFT JOIN activity_feedback_read r ON r.feedback_id=f.报名行ID AND r.account_id=?
  WHERE f.活动ID IN (SELECT value FROM json_each(?)) AND (?='' OR f.模板类型=?) AND (?='' OR f.报名行ID=?)
  ORDER BY f.提交时间 DESC, f.报名行ID LIMIT ? OFFSET ?`);
 const unread=db.prepare(`SELECT f.报名行ID,f.活动ID FROM 活动反馈表 f WHERE f.活动ID IN (SELECT value FROM json_each(?))
  AND NOT EXISTS (SELECT 1 FROM activity_feedback_read r WHERE r.feedback_id=f.报名行ID AND r.account_id=?) ORDER BY f.提交时间 DESC LIMIT 24`);
 const mark=db.prepare('INSERT OR IGNORE INTO activity_feedback_read VALUES (?,?)');
 const pending=db.prepare(`SELECT f.报名行ID AS id, f.活动ID AS eventId FROM activity_feedback_outbox o JOIN 活动反馈表 f
   ON f.报名行ID=o.feedback_id WHERE o.next_at<=? ORDER BY o.next_at, f.提交时间 LIMIT 24`);
 const delay=db.prepare('UPDATE activity_feedback_outbox SET next_at=? WHERE feedback_id=?');
 const complete=db.prepare('DELETE FROM activity_feedback_outbox WHERE feedback_id=?');
 const delivered=db.prepare('SELECT 1 FROM activity_feedback_delivery WHERE delivery_key=?');
 const recordDelivery=db.prepare('INSERT OR IGNORE INTO activity_feedback_delivery VALUES (?)');
 const observe=(operation,task)=>observer.dependency('storage',operation,task);
 const view=row=>row?{template:row['模板类型'],rating:row['评分'],answers:JSON.parse(row['正文']),version:row['版本']}:null;
 function own(row,account){
  const previous=find.get(row._id);
  if(previous&&previous['账号ID']!==account.accountId)throw fail(403,'无法读取这条反馈');
  return previous;
 }
 return {
  close:()=>db.close(),
  eventIds:()=>observe('activity-feedback-index',()=>findEvents.all().map(row=>row['活动ID'])),
  list:({actor,ids,template='',id='',limit,offset=0})=>observe('activity-feedback-list',()=>list.all(actor,JSON.stringify(ids),template,template,id,id,limit,offset)
   .map(row=>({...view(row),id:row['报名行ID'],eventId:row['活动ID'],name:row['姓名'],submittedAt:row['提交时间'],updatedAt:row['修改时间'],reviewed:Boolean(row.reviewed)}))),
  unread:(actor,ids)=>observe('activity-feedback-unread',()=>unread.all(JSON.stringify(ids),actor)),
  markRead:(id,actor)=>observe('activity-feedback-mark-read',()=>mark.run(id,actor)),
  pending:()=>observe('activity-feedback-outbox',()=>pending.all(now())),
  defer:id=>observe('activity-feedback-outbox',()=>delay.run(now()+60_000,id)),
  complete:id=>observe('activity-feedback-outbox',()=>complete.run(id)),
  delivered:key=>observe('activity-feedback-delivery',()=>Boolean(delivered.get(key))),
  recordDelivery:key=>observe('activity-feedback-delivery',()=>recordDelivery.run(key)),
  submitted:accountId=>observe('activity-feedback-status',()=>new Set(submitted.all(accountId).map(row=>row['报名行ID']))),
  read:(row,account)=>observe('activity-feedback-read',()=>view(own(row,account))),
  write:(row,account,template,body)=>observe('activity-feedback-write',()=>{
   const previous=own(row,account),current=previous?.['模板类型']||template;
   const questions=ACTIVITY_FEEDBACK_TEMPLATES[current].questions;
   const {rating=null,answers,version}=body||{};
   if(!Array.isArray(answers)||answers.length!==questions.length||answers.some(answer=>typeof answer!=='string'||answer.length>2000)||
      (current==='rating'?(!Number.isInteger(rating)||rating<1||rating>5):rating!==null))throw fail(400,'请按反馈模板填写，单项最多 2000 字');
   const normalized=answers.map(answer=>answer.trim());
   if(current!=='rating'&&normalized.some(answer=>!answer))throw fail(400,'请填写所有反馈问题');
   if(version!==(previous?.['版本']||0))throw fail(409,'反馈已更新，请重新打开后修改');
   const timestamp=new Date(now()).toISOString(),content=JSON.stringify(normalized);
   const result=previous?update.run(rating,content,timestamp,row._id,account.accountId,version):
    insert.run(row['活动ID'],row._id,account.accountId,row['学号'],row['姓名'],current,rating,content,timestamp,timestamp);
   if(!result.changes)throw fail(409,'反馈已更新，请重新打开后修改');
   return view(find.get(row._id));
  }),
 };
}
