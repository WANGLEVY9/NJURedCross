import test from 'node:test';
import assert from 'node:assert/strict';
import {bloodSourceEventId} from '../lib/events/blood-source.js';
import {createBloodNotificationReview} from '../lib/events/blood-notification-review.js';
import {createRegistrationNotifications,NOTIFICATION_TABLE} from '../lib/events/registration-notifications.js';

const date='2030-01-01',place='合成点位',slot='上午',eventId=bloodSourceEventId(date,place,slot);
const event={_id:eventId,活动ID:eventId,活动名称:'合成献血班次',地点:place,报名页配置:'{"source":{"kind":"generated_blood"}}'};
function booking(n){
 const studentId=`23456789${n}`;
 return [
  {_id:`registration-${n}`,活动ID:eventId,报名ID:`WR-${n}`,账号ID:`member-${n}`,学号:studentId,姓名:'合成志愿者',邮箱:`${studentId}@smail.nju.edu.cn`,
   岗位源行ID:`source-${n}`,岗位同步状态:'已同步',报名状态:'已确认',是否报名成功:true,报名日期:date,报名时段:slot},
  {_id:`source-${n}`,网站报名ID:`WR-${n}`,网站账号ID:`member-${n}`,学号:studentId,日期:date,点位:place,活动时间:slot,报名结果:'失败'},
 ];
}

test('bottom-table changes block queued mail and release applies to one reviewed row',async t=>{
 const [first,a]=booking(1),[second,b]=booking(2),registrations=[first,second],sources=[a,b];
 const review=createBloodNotificationReview({path:':memory:',readSourceRow:async id=>sources.find(row=>row._id===id)});
 t.after(()=>review.close());
 const tasks=[{_id:'baseline',幂等键:'INIT:REGISTRATION-NOTIFICATIONS'}],sent=[];
 const base={
  listRows:async(table,view,fields,convert,start,limit)=>{assert.equal(table,NOTIFICATION_TABLE);return tasks.slice(start,start+limit);},
  appendRow:async(table,row)=>{assert.equal(table,NOTIFICATION_TABLE);const saved={...row,_id:`task-${tasks.length}`};tasks.push(saved);return saved;},
  updateRow:async(table,id,patch)=>{assert.equal(table,NOTIFICATION_TABLE);Object.assign(tasks.find(row=>row._id===id),patch);},
 };
 const notifications=createRegistrationNotifications(base,{enabled:()=>true,permitsBloodMail:(event,row)=>review.permits(row),
  send:async message=>{sent.push(message.to);return {ok:true,transport:'smtp'};}});
 const reconcile=()=>notifications.reconcile({events:[event],registrations});
 await reconcile();
 assert.deepEqual(sent,[]);
 const old=review.list(registrations,sources).find(row=>row.id===first._id);
 assert.equal(old.actual,'失败');
 assert.equal(old.canRelease,false);
 assert.ok(!JSON.stringify(old).includes(first.学号));
 await assert.rejects(review.release(first,old.id,old.revision),{statusCode:409});

 a.报名结果=b.报名结果='成功';
 await reconcile();
 assert.deepEqual(sent,[]);
 await assert.rejects(review.release(first,old.id,old.revision),{statusCode:409});
 const current=review.list(registrations,sources).find(row=>row.id===first._id);
 assert.equal(current.canRelease,true);
 await review.release(first,current.id,current.revision);
 await reconcile();
 await reconcile();
 assert.deepEqual(sent,[first.邮箱]);
 assert.deepEqual(review.list(registrations,sources).map(row=>row.id),[second._id]);
});

test('a premature manual success is retained when the platform later confirms; an upstream timeout fails closed',async t=>{
 const [row,source]=booking(1);
 source.报名结果='成功';
 let read=async()=>source;
 const review=createBloodNotificationReview({path:':memory:',readSourceRow:()=>read()});
 t.after(()=>review.close());
 row.报名状态='待筛选';
 assert.equal(review.inspect(row,source).expected,'待审核');
 row.报名状态='已确认';
 assert.equal(await review.permits(row),false);
 const [item]=review.list([row],[source]);
 await review.release(row,item.id,item.revision);
 assert.equal(await review.permits(row),true);
 read=async()=>{throw Object.assign(new Error('synthetic upstream message'),{code:'ETIMEDOUT'});};
 await assert.rejects(review.permits(row),{code:'ETIMEDOUT'});
});

test('a verified platform write does not quarantine a confirmation whose website write is retried',async t=>{
 const [row,source]=booking(1);
 const review=createBloodNotificationReview({path:':memory:',readSourceRow:async()=>source});
 t.after(()=>review.close());
 row.报名状态='待筛选';
 source.报名结果='待审核';
 assert.equal(review.inspect(row,source),null);
 source.报名结果='成功';
 review.recordConfirmation(row._id,source._id);
 assert.deepEqual(review.list([row],[source]),[]);
 row.报名状态='已确认';
 review.finishConfirmation(row._id);
 assert.equal(await review.permits(row),true);
});
