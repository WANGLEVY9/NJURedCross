import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWorkflow,WF} from '../lib/events/workflow.js';

const body={name:'合成值班',date:'2026-10-04',slot:'上午',position:'签到岗',capacity:2,serviceHours:2,trainingHours:0.5,travelHours:1,location:'测试地点',work:'合成现场服务'};
const t0=()=>Date.parse('2026-10-04T09:00:00+08:00');
const student={accountId:'synthetic-account',studentId:'999990001',realName:'测试同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
function fixture(now=t0,tables=Object.fromEntries(Object.values(WF).map(name=>[name,[]]))){
 let seq=0;const state={tables};
 const base={async listRows(table,_v,_o,_c,start=0,limit=500){return structuredClone(state.tables[table].slice(start,start+limit));},async appendRow(table,row){const r={...row,_id:`r-${++seq}`};state.tables[table].push(r);return {_id:r._id};},async updateRow(table,id,patch){Object.assign(state.tables[table].find(r=>r._id===id),patch);}};
 const workflow=createWorkflow(base,{now});
 return {tables:state.tables,workflow};
}
async function published(w,now=t0){const e=await w.create(body,'organizer');await w.approve(e._id,'reviewer');await w.publish(e._id);return e;}

test('请假获批释放名额并允许重新报名，旧请假历史保留且新报名使用新报名ID',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const first=await w.register(e._id,student);await w.confirm(first._id);
 await w.requestLeave(first.报名ID,student,'合成请假原因');
 await w.decideLeave(first._id,true,'合成审批');
 assert.equal(tables[WF.registrations][0].报名状态,'已请假');
 const second=await w.register(e._id,student);
 assert.notEqual(second._id,first._id);
 assert.notEqual(second.报名ID,first.报名ID);
 assert.equal(second.报名状态,'待筛选');
 assert.equal(tables[WF.registrations].length,2);
 assert.equal(tables[WF.registrations][0].报名状态,'已请假');
});

test('已签到的报名不被误释放，仍阻止重复报名',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const r=await w.register(e._id,student);await w.confirm(r._id);
 await w.checkin(r._id,'checker','合成到场核验');
 assert.equal(tables[WF.registrations][0].报名状态,'已签到');
 await assert.rejects(w.register(e._id,student),{statusCode:409});
});

test('请假待审批的报名不被误释放，仍阻止重复报名',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const r=await w.register(e._id,student);await w.confirm(r._id);
 await w.requestLeave(r.报名ID,student,'合成请假原因');
 assert.equal(tables[WF.registrations][0].报名状态,'已确认'); // 待审批不改写报名状态
 assert.equal(tables[WF.registrations][0].请假状态,'待审批');
 await assert.rejects(w.register(e._id,student),{statusCode:409});
});

test('并发抢最后一个名额不超卖',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const one=await w.register(e._id,student); // 占 1 个名额，容量 2 还剩 1
 const out=await Promise.allSettled([
  w.register(e._id,{...student,accountId:'b',studentId:'999990002',email:'999990002@smail.nju.edu.cn'}),
  w.register(e._id,{...student,accountId:'c',studentId:'999990003',email:'999990003@smail.nju.edu.cn'}),
 ]);
 // 并发抢剩余最后一个名额：只有一个成功
 assert.equal(out.filter(r=>r.status==='fulfilled').length,1);
 const succeeded=out.find(r=>r.status==='fulfilled');
 assert.equal(succeeded.value.报名ID!==one.报名ID,true);
 const occupied=tables[WF.registrations].filter(r=>['待筛选','已确认','已签到'].includes(r.报名状态));
 assert.equal(occupied.length,2); // 恰好等于容量，不超卖
});

test('签到凭证：签发后核验成功、重复签到幂等且留痕核验人/说明',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const r=await w.register(e._id,student);await w.confirm(r._id);
 const issued=await w.issueCheckinTicket(r._id,'operator');
 assert.ok(issued.ticket&&issued.ticket.startsWith('WCT-'));
 const first=await w.checkinByTicket(issued.ticket,'checker','现场核验A');
 assert.equal(first.核验人,'checker');
 assert.equal(first.核验说明,'现场核验A');
 assert.equal(first.报名行ID,r._id);
 const second=await w.checkinByTicket(issued.ticket,'checker','现场核验B'); // 幂等：同一条
 assert.equal(second._id,first._id);
 assert.equal(tables[WF.checkins].length,1);
});

test('签到凭证：无效与过期均被拒绝',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const r=await w.register(e._id,student);await w.confirm(r._id);
 await assert.rejects(w.checkinByTicket('not-a-ticket','checker','x'),{statusCode:403});
 const issued=await w.issueCheckinTicket(r._id,'operator');
 // 过期：同一份数据、更晚的时钟；回退密钥固定故能验签，但超过有效期被拒
 const {workflow:later}=fixture(()=>Date.parse('2026-10-04T10:00:00+08:00'),tables);
 await assert.rejects(later.checkinByTicket(issued.ticket,'checker','x'),{statusCode:409});
});

test('签到凭证：内容被篡改（指向另一个报名）后验签失败被拒，无法转移签到授权',async()=>{
 const {tables,workflow:w}=fixture();
 const e=await published(w);
 const r1=await w.register(e._id,student);await w.confirm(r1._id);
 const r2=await w.register(e._id,{...student,accountId:'second',studentId:'999990002',email:'999990002@smail.nju.edu.cn'});await w.confirm(r2._id);
 const issued=await w.issueCheckinTicket(r1._id,'operator');
 // 篡改 payload 的 reg 指向 r2，保留原签名 -> 验签不匹配 -> 拒绝，凭证无法转移到别的报名
 const [prefix, body, mac] = issued.ticket.split('.');
 const tampered = `${prefix}.${Buffer.from(JSON.stringify({reg:r2._id,act:e['活动ID'],exp:Date.parse('2026-10-04T09:30:00+08:00')}),'utf8').toString('base64url')}.${mac}`;
 await assert.rejects(w.checkinByTicket(tampered,'checker','x'),{statusCode:403});
});
