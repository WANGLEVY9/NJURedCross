import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceProjectPeopleOptions,assertWorkspaceResponsible} from '../lib/events/workspace-responsible.js';
import {normalizeWorkspaceDraft} from '../public/app/shared/activity-workspace.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createMutationQueue} from '../lib/events/safety.js';

const row=(accountId,role,name,categories=['生命中心'])=>({accountId,role,name,region:'nanjing',categories,active:true});
const roster=()=>({complete:true,rows:[row('owner','director','合成立项人'),row('co','director','合成协作人'),row('chair','presidium','合成中心主席'),row('jin','global','金中宸'),row('yuan','global','袁金雨'),row('other','global','合成其他总权限'),row('outside','director','其他中心',['博爱中心'])]});
const content=()=>({name:'合成项目',region:'nanjing',category:'生命中心',projectOwnerId:'owner',responsibleId:'owner',responsibleIds:['owner','co'],reviewerIds:['chair','jin','yuan']});

test('people options separate self, collaborators and default role-verified reviewers',()=>{
  const options=workspaceProjectPeopleOptions('owner','nanjing','生命中心',roster());
  assert.deepEqual(options.self,{id:'owner',name:'合成立项人'});
  assert(!options.collaborators.some(row=>row.id==='outside'));
  assert.deepEqual(options.defaultReviewerIds.sort(),['chair','jin','yuan']);assert.deepEqual(options.unavailableDefaults,[]);
  const invalid=roster();invalid.rows.find(row=>row.accountId==='jin').role='director';
  assert(!workspaceProjectPeopleOptions('owner','nanjing','生命中心',invalid).defaultReviewerIds.includes('jin'));
  assert.throws(()=>workspaceProjectPeopleOptions('owner','suzhou','生命中心',roster()),{statusCode:403});
});

test('ownership is immutable and collaborator and reviewer choices cannot grant permissions',()=>{
  assert.equal(assertWorkspaceResponsible(content(),'owner',roster(),{ownerId:'owner',required:true}),'owner');
  assert.throws(()=>assertWorkspaceResponsible(content(),'owner',roster(),{ownerId:'other'}),{statusCode:403});
  assert.throws(()=>assertWorkspaceResponsible({...content(),responsibleIds:['owner','outside']},'owner',roster()),{statusCode:403});
  assert.throws(()=>assertWorkspaceResponsible({...content(),reviewerIds:['co']},'owner',roster()),{statusCode:403});
  assert.throws(()=>normalizeWorkspaceDraft({...content(),reviewerIds:['jin','jin']}),{statusCode:400});
  assert.throws(()=>normalizeWorkspaceDraft({...content(),responsibleId:'co',responsibleIds:['co']}),{statusCode:400});
});

test('selected reviewers are bound to the application and any one can approve with fresh authority',async()=>{
  const data=roster(),routing=createWorkspaceApprovalRouting({getRoster:async()=>data});
  const event={状态:'待审核',活动地区:'南京地区',组织类别:'生命中心',申请版本:1,报名页配置:JSON.stringify({center:'生命中心',region:'南京活动',workspaceReviewerIds:['chair','jin','yuan']})};
  const config=JSON.parse(event.报名页配置);config.approval=await routing.assign(event);event.报名页配置=JSON.stringify(config);
  assert.deepEqual(config.approval.reviewerIds,['chair','jin','yuan']);assert.equal(config.approval.policy,'any');
  for(const id of ['chair','jin','yuan'])assert.equal((await routing.assertReviewer(event,id)).reviewerId,id);
  await assert.rejects(routing.assertReviewer(event,'other'),{statusCode:403});
  data.rows.find(row=>row.accountId==='jin').active=false;await assert.rejects(routing.assertReviewer(event,'jin'),{statusCode:403});
});

test('draft identity and retry lookups use keyed reads instead of traversing draft storage',async t=>{
  const store=openWorkspaceDraftStore(':memory:');t.after(()=>store.close());let scans=0;
  const service=createWorkspaceDrafts({...store,read:()=>{scans++;throw Error('unexpected table scan');},authorize:async()=>{},queue:createMutationQueue(),validateResponsible:(d,actor,options)=>assertWorkspaceResponsible(d,actor,roster(),options)});
  const created=await service.create({requestId:'synthetic-keyed-people',content:content()},'owner');
  assert.equal((await service.get(created.id,'owner')).ownerId,'owner');
  await service.save(created.id,{expectedVersion:1,content:{...content(),description:'补充说明'}},'owner');
  assert.equal((await service.create({requestId:'synthetic-keyed-people',content:content()},'owner')).id,created.id);
  const copied=await service.copy(created.id,{expectedVersion:2,requestId:'synthetic-people-copy'},'co');
  assert.equal(copied.ownerId,'co');assert.equal(copied.content.projectOwnerId,'co');assert.deepEqual(copied.content.responsibleIds,['co','owner']);assert.deepEqual(copied.content.reviewerIds,['chair','jin','yuan']);
  await assert.rejects(service.save(created.id,{expectedVersion:2,content:{...content(),projectOwnerId:'co',responsibleId:'co',responsibleIds:['co']}},'owner'),{statusCode:403});
  assert.equal(scans,0);
});

test('eligible collaborator editors remain selectable on another creator draft',()=>{
 const options=workspaceProjectPeopleOptions('co','nanjing','生命中心',roster());
 assert.equal(options.self.id,'co');
 assert(options.collaborators.some(row=>row.id==='co'));
 assert(options.collaborators.some(row=>row.id==='owner'));
 assert(!options.collaborators.some(row=>row.id==='outside'));
});
