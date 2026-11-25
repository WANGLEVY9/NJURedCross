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

export function createActivityFeedbackStore(path){
 const db=new DatabaseSync(path);
 db.exec(`CREATE TABLE IF NOT EXISTS 活动反馈表 (
  活动ID TEXT NOT NULL, 报名行ID TEXT PRIMARY KEY, 账号ID TEXT NOT NULL, 学号 TEXT NOT NULL, 姓名 TEXT NOT NULL,
  模板类型 TEXT NOT NULL, 评分 INTEGER, 正文 TEXT NOT NULL, 提交时间 TEXT NOT NULL, 修改时间 TEXT NOT NULL, 版本 INTEGER NOT NULL
 ); CREATE INDEX IF NOT EXISTS activity_feedback_account ON 活动反馈表(账号ID);`);
 const find=db.prepare('SELECT * FROM 活动反馈表 WHERE 报名行ID=?');
 const submitted=db.prepare('SELECT 报名行ID FROM 活动反馈表 WHERE 账号ID=?');
 const insert=db.prepare('INSERT INTO 活动反馈表 VALUES (?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(报名行ID) DO NOTHING');
 const update=db.prepare('UPDATE 活动反馈表 SET 评分=?,正文=?,修改时间=?,版本=版本+1 WHERE 报名行ID=? AND 账号ID=? AND 版本=?');
 const observe=(operation,task)=>observer.dependency('storage',operation,task);
 const view=row=>row?{template:row['模板类型'],rating:row['评分'],answers:JSON.parse(row['正文']),version:row['版本']}:null;
 function own(row,account){
  const previous=find.get(row._id);
  if(previous&&previous['账号ID']!==account.accountId)throw fail(403,'无法读取这条反馈');
  return previous;
 }
 return {
  close:()=>db.close(),
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
   const now=new Date().toISOString(),content=JSON.stringify(normalized);
   const result=previous?update.run(rating,content,now,row._id,account.accountId,version):
    insert.run(row['活动ID'],row._id,account.accountId,row['学号'],row['姓名'],current,rating,content,now,now);
   if(!result.changes)throw fail(409,'反馈已更新，请重新打开后修改');
   return view(find.get(row._id));
  }),
 };
}
