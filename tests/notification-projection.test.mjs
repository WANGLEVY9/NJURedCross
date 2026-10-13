import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
function extract(start,end,bindings){
 const box={...bindings};vm.createContext(box);
 vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),box);
 return box;
}
test('notification event projection reads only projects and preserves draft identities',async()=>{
 const calls=[];const projects=[{name:'Synthetic draft',status:'草稿'}];
 const box=extract('async function getEventsOverview(', '/**\n * Shared registration pipeline',{
  eventProjectTable:'projects',eventSessionTable:'sessions',eventRegistrationTable:'registrations',
  listAllRows:async(_c,t)=>{calls.push(t);return t==='projects'?projects:[];},eventSummary:r=>r,
  readMeta:()=>({}),dailySeries:()=>[],
 });
 const result=await box.getEventsOverview({}, {notificationsOnly:true});
 assert.deepEqual(calls,['projects']);assert.equal(result.events[0].name,'Synthetic draft');
 calls.length=0;await box.getEventsOverview({});assert.deepEqual(calls,['projects','sessions','registrations']);
});
test('notification hours queue matches full overview without profiles, approvals or summary reads',async()=>{
 const calls=[];const registrations=[{_id:'synthetic',活动名称:'Synthetic',姓名:'Test'}];
 const box=extract('async function getVolunteerOverview(', 'async function safeRows(',{
  volunteerRows:async(_c,t)=>{calls.push(t);return t==='活动报名总表'?registrations:[];},
  summarizeVolunteerWorkflow:()=>({groups:[],states:{}}),cellText:(v,f='')=>v||f,maskedApplicant:v=>v,
  registrationReadiness:()=>({state:'待录入',hours:2,problems:[]}),readMeta:()=>({}),volunteerBaseUuid:'synthetic',isFlagOn:()=>false,
 });
 const lean=await box.getVolunteerOverview({}, {notificationsOnly:true});
 assert.deepEqual(calls,['活动报名总表','活动签到']);calls.length=0;
 const full=await box.getVolunteerOverview({});assert.equal(calls.length,5);
 assert.equal(JSON.stringify(lean.hoursQueue),JSON.stringify(full.hoursQueue));
});
test('outreach notification projection excludes unrelated signup notice table',async()=>{
 let notices=0;
 const box=extract('async function getOutreachOverview(', 'async function getNotificationsOverview(',{
  buildCampaignRows:async()=>({counts:{planning:0,creative:0},rows:[]}),volunteerBase:true,
  getVolunteerBase:async()=>({}),safeRows:async()=>{notices++;return[];},process:{env:{}},
  readOutreachReviews:async()=>({}),readOutreachPublications:async()=>({}),readOutreachAssignees:async()=>[],readOutreachSubmissionRows:async()=>[],
 });
 const lean=await box.getOutreachOverview({}, {notificationsOnly:true});assert.equal(notices,0);
 const full=await box.getOutreachOverview({});assert.equal(notices,1);
 assert.equal(JSON.stringify(lean.campaigns),JSON.stringify(full.campaigns));
});
