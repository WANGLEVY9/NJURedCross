import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkspaceDraft,workspaceDraftErrors,workspaceCategories,workspaceStage,workspacePermissions,workspaceNotice} from '../public/app/shared/activity-workspace.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';

const content=()=>normalizeWorkspaceDraft({name:'合成多日活动',region:'nanjing',category:'生命中心',bookingMode:'grouped',date:'2030-01-01',endDate:'2030-01-03',deadline:'2029-12-31T18:00',notice:'合成通知',positions:[{id:'pos-1',name:'引导',date:'2030-01-02',start:'09:15',end:'11:45',campus:'仙林',location:'合成地点',capacity:'4',serviceHours:'2.5',trainingHours:'0',travelHours:'0',work:'合成任务'}]});
function fixture(){
 const rows=[];let tail=Promise.resolve();let writes=0;
 const queue=task=>{const next=tail.then(task);tail=next.catch(()=>{});return next;};
 const service=createWorkspaceDrafts({read:async()=>structuredClone(rows),append:async row=>{writes++;rows.push(structuredClone(row));},update:async(id,patch)=>{writes++;Object.assign(rows.find(r=>r.id===id),structuredClone(patch));},authorize:async(row,actor)=>{if(actor!=='owner'||row.ownerId!=='owner')throw Object.assign(Error('forbidden'),{statusCode:403});},queue});
 return {rows,service,writes:()=>writes};
}

test('draft removal retains its content, hides the card and safely reconciles the original request',async()=>{
 const f=fixture(),args={requestId:'synthetic-remove-create',content:content()},draft=await f.service.create(args,'owner');
 const body={requestId:'synthetic-remove-request',expectedVersion:draft.version};
 await assert.rejects(f.service.remove(draft.id,body,'other'),{statusCode:403});
 await assert.rejects(f.service.remove(draft.id,{...body,expectedVersion:0},'owner'),{statusCode:409});
 assert.deepEqual(await f.service.remove(draft.id,body,'owner'),{id:draft.id,removed:true});const writes=f.writes();
 assert.deepEqual(await f.service.remove(draft.id,body,'owner'),{id:draft.id,removed:true});assert.equal(f.writes(),writes);
 assert.deepEqual(await f.service.list('owner'),[]);assert.deepEqual(f.rows[0].content,draft.content);assert.equal(f.rows[0].removal.actor,'owner');
 await assert.rejects(f.service.get(draft.id,'owner'),{statusCode:410});
 await assert.rejects(f.service.create(args,'owner'),{statusCode:410});
 await assert.rejects(f.service.copy(draft.id,{requestId:'synthetic-copy-removed',expectedVersion:2},'owner'),{statusCode:410});
 await assert.rejects(f.service.save(draft.id,{expectedVersion:2,content:draft.content},'owner'),{statusCode:409});
 await assert.rejects(f.service.preview(draft.id,{expectedVersion:2},'owner'),{statusCode:410});
 await assert.rejects(f.service.remove(draft.id,{...body,requestId:'synthetic-other-remove'},'owner'),{statusCode:409});
});

test('draft removal cannot discard a pending or completed workflow submission',async()=>{
 for(const status of ['pending','complete']){const f=fixture(),draft=await f.service.create({requestId:'synthetic-remove-claim',content:{name:'合成'}},'owner');f.rows[0].submission={status};
  await assert.rejects(f.service.remove(draft.id,{requestId:'synthetic-remove-request',expectedVersion:1},'owner'),{statusCode:409});assert.equal(f.rows[0].removal,undefined);
 }
});
test('categories retain full canonical labels and bind five/seven categories to region',()=>{
 assert.deepEqual(workspaceCategories('suzhou'),['主席团专项','博爱中心','生命中心','综事中心','排班类']);assert.equal(workspaceCategories('nanjing').length,7);
 assert.throws(()=>normalizeWorkspaceDraft({name:'合成',region:'suzhou',category:'献血车专项'}),/不匹配/);
});
test('save accepts only a name without inventing date, mode, numbers or owner identity',()=>{
 const d=normalizeWorkspaceDraft({name:'  合成草稿  '});assert.equal(d.name,'合成草稿');for(const k of ['date','bookingMode','serviceHours','capacity'])assert.equal(d[k],'');assert.deepEqual(d.positions,[]);
 for(const unknown of ['ownerId','role','version','__proto__'])assert.throws(()=>normalizeWorkspaceDraft(JSON.parse(`{"name":"合成","${unknown}":"bad"}`)),/字段/);
});
test('calendar and minute validation rejects impossible dates, inverted times and out-of-window positions',()=>{
 const d=content();assert.deepEqual(workspaceDraftErrors(d),[]);
 for(const patch of [{date:'2030-02-30'},{endDate:'2029-12-31'}])assert.ok(workspaceDraftErrors({...d,...patch}).length);
 for(const patch of [{date:'2030-01-04'},{start:'24:00'},{end:'08:15'},{campus:'苏州'},{capacity:'1.5'},{trainingHours:'-1'},{serviceHours:'0'}])assert.ok(workspaceDraftErrors({...d,positions:[{...d.positions[0],...patch}]}).length);
});
test('multi-day unified range is valid across midnight without deriving service hours from elapsed days',()=>{
 const d={...content(),bookingMode:'unified',positions:[],start:'23:30',end:'01:15',location:'合成地点',capacity:'20',serviceHours:'3',trainingHours:'',travelHours:'0',work:'合成任务'};
 assert.deepEqual(workspaceDraftErrors(d),[]);assert.equal(normalizeWorkspaceDraft(d).serviceHours,'3');
});
test('six stages keep approved but unpublished activity in pending approval; ledger existence alone does not advance stage',()=>{
 assert.equal(workspaceStage({状态:'可发布'}),'待审批');assert.equal(workspaceStage({状态:'草稿'}),'草稿');assert.equal(workspaceStage({状态:'进行中'}),'进行中');assert.equal(workspaceStage({状态:'进行中'},{hoursSubmitted:true}),'时长审核');
});
test('region-bound current roster evidence denies cross-region chair, unrelated director and unverified actor',()=>{
 const event={ownerId:'owner',region:'suzhou',category:'生命中心',stage:'待审批'};
 const chair={verified:true,active:true,actor:'chair',region:'suzhou',role:'presidium',categories:['生命中心']};
 assert.equal(workspacePermissions(event,chair).review,true);assert.equal(workspacePermissions(event,{...chair,region:'nanjing'}).review,false);assert.equal(workspacePermissions(event,{...chair,verified:false}).review,false);
 const owner={...chair,actor:'owner',role:'director'};assert.equal(workspacePermissions(event,owner).edit,false);assert.equal(workspacePermissions({...event,stage:'草稿'},owner).edit,true);assert.equal(workspacePermissions({...event,stage:'草稿'},{...owner,actor:'other'}).edit,false);
 assert.equal(workspacePermissions({ownerId:'owner',region:'',category:'',stage:'草稿'},owner).edit,true);
});
test('notice preserves per-position day and exact clock minutes without collapsing distinct jobs',()=>{
 const d=content();d.positions.push({...d.positions[0],id:'pos-2',name:'签到',date:'2030-01-03',start:'13:10',end:'15:20'});
 const text=workspaceNotice(d);assert.match(text,/【工作内容】\n1\. 引导/);assert.match(text,/2\. 签到/);assert.match(text,/【结果通知】/);assert.match(text,/2030-01-02 09:15—11:45/);assert.match(text,/2030-01-03 13:10—15:20/);assert.match(text,/签到/);
});
test('creation request retries preserve stable identity and reject reusing key for different input',async()=>{
 const f=fixture(),args={requestId:'synthetic-request-1',content:{name:'合成'}};
 const [a,b]=await Promise.all([f.service.create(args,'owner'),f.service.create(args,'owner')]);assert.equal(a.id,b.id);assert.equal(f.rows.length,1);assert.equal(f.writes(),1);
 await assert.rejects(f.service.create({...args,content:{name:'另一活动'}},'owner'),e=>e.statusCode===409);assert.equal(f.rows.length,1);
});
test('concurrent saves cannot silently overwrite the first successful revision',async()=>{
 const f=fixture(),a=await f.service.create({requestId:'synthetic-request-2',content:content()},'owner');
 const results=await Promise.allSettled(['改动甲','改动乙'].map(name=>f.service.save(a.id,{expectedVersion:1,content:{...a.content,name}},'owner')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows[0].version,2);
 await assert.rejects(f.service.save(a.id,{expectedVersion:2,content:content()},'other'),e=>e.statusCode===403);
});
test('preview is read-only, confirmation binds actor and saved revision, later save invalidates it',async()=>{
 const f=fixture(),a=await f.service.create({requestId:'synthetic-request-3',content:content()},'owner');const writes=f.writes();
 const preview=await f.service.preview(a.id,{expectedVersion:1},'owner');assert.equal(f.writes(),writes);assert.deepEqual(preview.errors,[]);
 await assert.rejects(f.service.submission(a.id,{expectedVersion:1,digest:preview.digest},'owner'),/必须预览/);
 await f.service.confirmPreview(a.id,{expectedVersion:1,digest:preview.digest},'owner');const plan=await f.service.submission(a.id,{expectedVersion:1,digest:preview.digest},'owner');assert.equal(plan.id,a.id);assert.equal(f.rows[0].stage,'草稿');
 await f.service.save(a.id,{expectedVersion:1,content:{...a.content,name:'新版本'}},'owner');
 await assert.rejects(f.service.confirmPreview(a.id,{expectedVersion:2,digest:preview.digest},'owner'),/失效/);
 await assert.rejects(f.service.submission(a.id,{expectedVersion:2,digest:preview.digest},'owner'),/必须预览/);
});
test('incomplete saved drafts may be viewed but cannot produce an approval submission plan',async()=>{
 const f=fixture(),a=await f.service.create({requestId:'synthetic-request-4',content:{name:'只有标题'}},'owner');const preview=await f.service.preview(a.id,{expectedVersion:1},'owner');assert.ok(preview.errors.length);
 await f.service.confirmPreview(a.id,{expectedVersion:1,digest:preview.digest},'owner');await assert.rejects(f.service.submission(a.id,{expectedVersion:1,digest:preview.digest},'owner'),e=>e.statusCode===400);
});


test('future scheduled publication stays in pending approval until the scheduled minute',()=>{
 const event={状态:'报名中',报名页配置:JSON.stringify({publishAt:'2030-01-01T09:15:00+08:00'})};
 assert.equal(workspaceStage(event,{now:Date.parse('2030-01-01T09:14:59+08:00')}),'待审批');assert.equal(workspaceStage(event,{now:Date.parse('2030-01-01T09:15:00+08:00')}),'报名中');
});
