import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {rosterReview,rosterMailKey} from '../public/app/shared/roster-review.js';
import {inlineReview,needsTableReview,reviewSections,ROSTER_RESULT_TABLE} from '../lib/events/roster-result-store.js';

assert.equal(ROSTER_RESULT_TABLE,WF.rosterResults);

async function fixture(count=2){
 let seq=0;const tables=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));
 const base={listRows:async(t,_v,_o,_c,s=0,n=500)=>structuredClone((tables[t]||[]).slice(s,s+n)),
  appendRow:async(t,r)=>{const row={...r,_id:'row-'+(++seq)};(tables[t]||(tables[t]=[])).push(row);return {_id:row._id};},
  updateRow:async(t,id,p)=>Object.assign(tables[t].find(r=>r._id===id),p)};
 const w=createWorkflow(base,{now:()=>Date.parse('2026-10-01T08:00+08:00')});
 const e=await w.create({name:'大名单活动',date:'2026-10-12',slot:'09:00-12:00',capacity:200,registrationLimit:200,serviceHours:3,location:'合成场地',work:'合成服务'},'owner');
 await w.approve(e._id,'reviewer');await w.publish(e._id);
 const people=Array.from({length:count},(_,i)=>({accountId:'p'+i,realName:'合成同学'+i,studentId:String(900000+i),email:String(900000+i)+'@smail.nju.edu.cn',emailVerified:true}));
 for(const p of people)await w.register(e._id,p);
 const event=()=>{const raw=tables[WF.events][0],meta=inlineReview(raw);
  if(!meta||!needsTableReview(meta))return raw;
  return {...raw,rosterState:{...meta,...reviewSections(tables[WF.rosterResults].filter(row=>row['活动ID']===raw['活动ID']))}};};
 const rows=()=>tables[WF.registrations],config=()=>JSON.parse(tables[WF.events][0]['报名页配置']);
 const token=async()=>(await w.overview()).events[0].rosterToken;
 const stage=async(ids,decision='confirm',reason='')=>w.stageRoster(e._id,ids,decision,reason,await token());
 const finalize=async()=>w.finalizeRoster(e._id,await token(),'reviewer');
 return {w,base,tables,event,rows,config,token,stage,finalize,id:e._id,
  resultRows:()=>tables[WF.rosterResults].filter(row=>row['活动ID']===e['活动ID'])};
}

test('150 人名单的结果全部落在独立表，报名页配置不再随人数增长',async()=>{
 const f=await fixture(150),ids=f.rows().map(r=>r._id);
 await f.stage(ids.slice(0,75));await f.stage(ids.slice(75),'reject','名额已满');
 const staged=f.config().rosterReview;
 assert.equal(staged.results,'table');
 // 只留元信息：阶段、修订号、成功邮件模板之类，与人数无关。
 assert.ok(JSON.stringify(staged).length<400,`暂定阶段配置应保持常量级：${JSON.stringify(staged).length}`);
 assert.equal(staged.published,undefined);assert.equal(staged.drafts,undefined);
 await f.finalize();
 const finalized=f.config().rosterReview;
 assert.ok(JSON.stringify(finalized).length<400,`最终确认后仍是常量级：${JSON.stringify(finalized).length}`);
 assert.ok(f.tables[WF.events][0]['报名页配置'].length<2000);
 const stored=f.resultRows();
 assert.equal(stored.length,150);
 assert.equal(stored.filter(row=>row['结果']==='已确认').length,75);
 assert.equal(stored.filter(row=>row['结果']==='未入选').length,75);
 // 读路径把结果合并回来，前端两个视图都不用改。
 const review=rosterReview(f.event());
 assert.equal(Object.keys(review.published).length,150);
 assert.equal(review.phase,'final');
 assert.equal(rosterMailKey(f.rows()[0],review.published[ids[0]]).startsWith('WF-RESULT:'),true);
});

test('已发布结果只在内容变化时写表，重复保存不换版本也不重发',async()=>{
 const f=await fixture(6),ids=f.rows().map(r=>r._id);
 await f.stage(ids);await f.finalize();
 const snapshot=()=>f.resultRows().map(row=>[row['报名行ID'],row['结果'],row['版本']]).sort();
 const before=snapshot();
 let writes=0;const update=f.base.updateRow;
 f.base.updateRow=async(t,id,p)=>{if(t===WF.rosterResults)writes++;return update(t,id,p);};
 // 重新打开再原样确认：结果与版本都不变，因此不会重发；写表只为清掉暂定列。
 await f.w.reopenRoster(f.id,await f.token());
 await f.stage(ids,'reset');await f.stage(ids);
 writes=0;await f.finalize();
 assert.deepEqual(snapshot(),before);
 assert.ok(writes<=ids.length,`原样确认只应清暂定列：${writes}`);
 // 只改一个人的结果：写入量与这一人同阶，而不是整份名单。
 await f.w.reopenRoster(f.id,await f.token());
 await f.stage([ids[0]],'reset');await f.stage([ids[0]],'reject','名额已满');
 writes=0;await f.finalize();
 assert.ok(writes<=2,`只改一个人只应写这一行：${writes}`);
 assert.equal(f.resultRows().find(row=>row['报名行ID']===ids[0])['结果'],'未入选');
});

test('发信只写对应的一行，不重写整份名单',async()=>{
 const f=await fixture(12),ids=f.rows().map(r=>r._id);
 await f.stage(ids);await f.finalize();
 let writes=0;const update=f.base.updateRow;
 f.base.updateRow=async(t,id,p)=>{if(t===WF.rosterResults)writes++;return update(t,id,p);};
 const send=async()=>({ok:true,transport:'smtp'});
 const first=await f.w.deliverRoster(f.id,{send});
 // 每轮最多处理 10 封，两轮覆盖 12 人。
 assert.equal(first.delivered,10);
 assert.ok(writes<=20,`首批回执写入应与收件人数同阶：${writes}`);
 const second=await f.w.deliverRoster(f.id,{send});
 assert.equal(second.delivered,12);
 // 12 人共 24 次回执写，而不是「每封都重写整份名单」的 144 次。
 assert.ok(writes<=24,`回执写入总数应与收件人数同阶：${writes}`);
 const third=await f.w.deliverRoster(f.id,{send});
 assert.equal(third.delivered,12);
 assert.ok(writes<=24,'已投递的人不再产生写入');
});

test('投递回执与审核结果共用一行，重开名单能读到待核对状态',async()=>{
 const f=await fixture(2),ids=f.rows().map(r=>r._id);
 await f.stage(ids);await f.finalize();
 const send=async()=>({ok:false,retryable:true});
 await f.w.deliverRoster(f.id,{send});
 const stored=f.resultRows();
 assert.ok(stored.every(row=>row['投递状态']==='failed'));
 assert.ok(stored.every(row=>row['投递键'].startsWith('WF-RESULT:')));
});
