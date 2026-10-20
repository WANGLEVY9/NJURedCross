import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovalRouting} from '../lib/events/approval-routing.js';
import {createWorkflow,WF,workflowEventApproved} from '../lib/events/workflow.js';
import {organizationAccess} from '../lib/events/organization-access.js';
import {organizationDirectory} from '../lib/events/organization-directory.js';

test('organization directory rejects partial or ambiguous identity evidence',async()=>{
 const accounts=[{accountId:'chair',studentId:'999990001',realName:'合成主席',emailVerified:true}];
 const rows=[{_id:'one',学号:'999990001',姓名:'合成主席',部门:'主席团 & 指导组'}];
 assert.equal((await organizationDirectory(accounts,{query:async()=>rows}))[0].organization.global,true);
 assert.equal((await organizationDirectory(accounts,{query:async()=>[...rows,...rows]}))[0].organization.global,false);
 await assert.rejects(organizationDirectory(accounts,{query:async()=>Object.assign([...rows],{readMeta:{truncated:true}})}),{statusCode:503});
});

test('selected chair recipients, any-one approval, chairman self-review and repeat protection',async()=>{
 const accounts=['one','two','director','unassigned'].map((id,i)=>({accountId:id,role:'member',emailVerified:true,studentId:`99999000${i+1}`,realName:`合成${id}`}));
 accounts.forEach(a=>{a.organization=organizationAccess(a,[{学号:a.studentId,姓名:a.realName,部门:a.accountId==='director'?'生命中心主任团':'主席团 & 指导组'}],{complete:true});});
 const routing=createApprovalRouting({organizationMode:true,getAccounts:async()=>accounts,store:{read:async()=>({version:0,mappings:{}})}});
 await assert.rejects(routing.save({version:0,mappings:{}}),{statusCode:403});
 assert.equal((await routing.settings()).reviewers.length,3);
 const rows=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));let seq=0;
 const base={getMetadata:async()=>({tables:[]}),listRows:async(t,_v,_o,_c,start=0,count=1000)=>structuredClone(rows[t].slice(start,start+count)),appendRow:async(t,row)=>{const saved={...row,_id:`test-${++seq}`};rows[t].push(saved);return {_id:saved._id};},updateRow:async(t,id,patch)=>Object.assign(rows[t].find(r=>r._id===id),patch)};
 const w=createWorkflow(base,{approvalRouting:routing});
 const body={name:'合成多审核人活动',date:'2030-10-29',slot:'09:00-11:00',capacity:10,serviceHours:2,location:'合成地点',work:'合成服务',center:'生命中心',reviewerIds:['one','two']};
 const event=await w.create(body,'one');
 assert.deepEqual(JSON.parse(event['报名页配置']).approval.reviewerIds,['one','two']);
 assert.equal((await routing.describe([rows[WF.events][0]],'one'))[0].approvalAccess.canReview,true);
 await assert.rejects(w.approve(event._id,'director','super_admin'),{statusCode:403});
 await assert.rejects(w.approve(event._id,'unassigned','member'),{statusCode:403});
 assert.equal((await routing.describe([rows[WF.events][0]],'unassigned'))[0].hoursAccess.canReview,false);
 assert.equal((await routing.describe([rows[WF.events][0]],'two'))[0].hoursAccess.canReview,true);
 await w.approve(event._id,'one','member');
 assert.equal(workflowEventApproved(rows[WF.events][0]),true);
 await assert.rejects(w.approve(event._id,'two','member'),{statusCode:409});
 await assert.rejects(w.create({...body,reviewerIds:['director']},'one'),{statusCode:400});
 accounts[1].status='停用';
 await assert.rejects(w.create(body,'one'),{statusCode:400});
});
