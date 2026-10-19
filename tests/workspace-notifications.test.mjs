import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceNotificationItems} from '../lib/events/workspace-notifications.js';
import {taskRoute} from '../public/app/console/task-route.js';
const roster={complete:true,rows:[{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:[]},{accountId:'director',region:'nanjing',role:'director',active:true,categories:['生命中心']},{accountId:'sz-chair',region:'suzhou',role:'presidium',active:true,categories:[]}]};
const draft={id:'draft-one',ownerId:'director',stage:'草稿',content:{name:'未提交活动',region:'nanjing',category:'生命中心',responsibleId:'director'}};
const event={_id:'event-one',活动名称:'待审批活动',组织类别:'生命中心',活动地区:'南京地区',申请版本:'1',负责人账号ID:'director',状态:'待审核',报名页配置:JSON.stringify({center:'生命中心',region:'南京地区',workspaceSubmission:{origin:true},approval:{mode:'workspace-regional',region:'nanjing',category:'生命中心',version:'1',reviewerIds:['chair']}})};
test('new activity tasks separate editable drafts, regional approval and unpublished activities',async()=>{
 const tasks=await workspaceNotificationItems({drafts:[draft,{...draft,id:'frozen',submission:{status:'claimed'}}],events:[event],actor:'chair',roster});assert.deepEqual(tasks.map(t=>t.type),['活动草稿待完善','活动待审批']);assert.equal(taskRoute(tasks[0]),'/console/events?draft=draft-one');assert.ok(taskRoute(tasks[1]).includes('event=event-one'));
 const director=await workspaceNotificationItems({drafts:[draft],events:[event],actor:'director',roster});assert.deepEqual(director.map(t=>t.type),['活动草稿待完善']);
 assert.deepEqual(await workspaceNotificationItems({drafts:[draft],events:[event],actor:'sz-chair',roster}),[]);
 const revoked={...roster,rows:roster.rows.map(r=>r.accountId==='chair'?{...r,active:false}:r)};assert.deepEqual(await workspaceNotificationItems({drafts:[draft],events:[event],actor:'chair',roster:revoked}),[]);
 const published={...event,状态:'可发布'};assert.equal((await workspaceNotificationItems({drafts:[],events:[published],actor:'chair',roster}))[0].type,'活动待发布');
 const config=JSON.parse(event['报名页配置']);assert.deepEqual(await workspaceNotificationItems({drafts:[],events:[{...published,报名页配置:JSON.stringify({...config,publishAt:'2030-01-01'})}],actor:'chair',roster}),[]);
 await assert.rejects(workspaceNotificationItems({drafts:[],events:[],actor:'chair',roster:{complete:false}}),{statusCode:503});
});
