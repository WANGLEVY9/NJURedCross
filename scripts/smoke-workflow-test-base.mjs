import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance();
/** Explicitly authorized synthetic writes in six dedicated test tables only. No mail. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {Base} from 'seatable-api';
import {createWorkflow,TEST_WORKFLOW_BASE,WF} from '../lib/events/workflow.js';
const run=`WFTEST-${Date.now()}`;
try{
 const base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await base.auth();if(base.dtableUuid!==TEST_WORKFLOW_BASE||base.dtableUuid!==process.env.SEATABLE_VOLUNTEER_BASE_UUID)throw Error('Test mismatch');
 const writes=[];const original={appendRow:base.appendRow.bind(base),updateRow:base.updateRow.bind(base)};
 const allowed=new Set(Object.values(WF));
 const adapter={listRows:base.listRows.bind(base),async appendRow(table,row){if(!allowed.has(table))throw Error('Unexpected write target');const result=await original.appendRow(table,row);writes.push({type:'append',table,rowId:result._id});return result;},async updateRow(table,id,patch){if(!allowed.has(table))throw Error('Unexpected write target');const result=await original.updateRow(table,id,patch);writes.push({type:'update',table,rowId:id,fields:Object.keys(patch)});return result;}};
 let interrupted=false;
 let flow=createWorkflow(adapter,{assertWritable:()=>assert.equal(base.dtableUuid,TEST_WORKFLOW_BASE),onStep:async step=>{if(step==='summary'&&!interrupted){interrupted=true;throw Error('SYNTHETIC_AFTER_SUMMARY');}}});
 const event=await flow.create({name:`工位值班【合成联调 ${run}】`,date:'2026-10-04',slot:'上午',position:'核验岗',capacity:1,serviceHours:2,trainingHours:0.5,travelHours:1,location:'合成测试地点',work:'仅测试，不代表实际服务'},`${run}-organizer`);
 await assert.rejects(flow.publish(event._id),{statusCode:409});await flow.approve(event._id,`${run}-reviewer`);await flow.publish(event._id);
 const account={accountId:run,studentId:'999990001',realName:'合成联调同学（非真实学生）',email:'999990001@smail.nju.edu.cn',emailVerified:true};
 const reg=await flow.register(event._id,account);await assert.rejects(flow.register(event._id,account),{statusCode:409});await flow.confirm(reg._id);await flow.checkin(reg._id,`${run}-checkin`,'合成到场证据，不代表真实出勤');
 const ledger=await flow.reviewHours(reg._id,`${run}-hour-reviewer`);assert.equal((await flow.reviewHours(reg._id,`${run}-hour-reviewer`))._id,ledger._id);await flow.approveHours(ledger._id,`${run}-hour-approver`);
 await assert.rejects(flow.post(ledger._id),/SYNTHETIC_AFTER_SUMMARY/);
 // Recreate the service to simulate restart; persisted approved ledger drives recovery.
 flow=createWorkflow(adapter);const recovery=await flow.post(ledger._id);const replay=await flow.post(ledger._id);assert.deepEqual(recovery,replay);
 const data=await flow.read();const own=(key)=>data[key].filter(row=>row['账号ID']===run);
 assert.equal(own('ledger').length,1);assert.equal(own('summaries').length,1);assert.equal(own('profiles').length,1);assert.equal(own('profiles')[0]['志愿时长'],'2');assert.equal(own('registrations')[0]['录入状态'],'网站已入账');
 const draft=await flow.exportDraft(event._id);assert.equal(draft.rows[0]['服务时长'],2);
 const report={exportPreview:{columns:draft.columns,rowCount:draft.rows.length,serviceHours:draft.rows[0]['服务时长'],trainingHours:draft.rows[0]['培训时长'],travelHours:draft.rows[0]['交通时长'],writes:false},run,mode:'live-test-base-synthetic',testBaseVerified:true,legacyWrites:0,emailSends:0,approvedServiceHours:2,trainingHours:0.5,travelHours:1,afterSummaryFailureRecovered:true,restartRecovered:true,repeatedPostUnchanged:true,recordIds:{event:event._id,registration:reg._id,ledger:ledger._id},counts:Object.fromEntries(['registrations','checkins','ledger','summaries','profiles'].map(key=>[key,own(key).length])),writes};
 await writeFile('reports/WORKFLOW_TEST_BASE_EVIDENCE_2026-10-04.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,writes:writes.length}));
}catch{console.error('Test-Base workflow verification failed; credentials/SDK details suppressed. Inspect synthetic run '+run);process.exitCode=1;}
