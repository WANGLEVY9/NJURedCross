import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readWorkspaceRoster} from '../lib/events/workspace-providers.js';
import {workspaceRosterEvidence,workspaceLevelAllowed} from '../lib/events/workspace-roster.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {organizationAuthority} from '../lib/events/organization-authority.js';
import {workspaceDraftAccess} from '../lib/events/workspace-draft-access.js';
import {workspaceResponsibleOptions} from '../lib/events/workspace-responsible.js';

const accounts=['synthetic-a','synthetic-b','synthetic-c'].map(accountId=>({accountId,username:accountId,role:'platform_admin',permissions:['events'],emailVerified:true,email:'synthetic@example.test',status:'启用',studentId:'999990001',realName:'合成人员'}));
const assignments=[
 {accountId:accounts[0].accountId,roles:['R01','R05'],initialCategories:['排班专项'],finalCategories:['主席团专项','综事中心']},
 {accountId:accounts[1].accountId,roles:['R01'],initialCategories:['排班专项'],finalCategories:[]},
 {accountId:accounts[2].accountId,roles:['R01','R02','R03','R05'],initialCategories:[],finalCategories:['主席团专项','博爱中心','生命中心','综事中心']},
];
const event=(category='综事中心',region='南京地区')=>({_id:'synthetic-event',活动ID:'synthetic-business',申请版本:'1',状态:'待审核',活动地区:region,组织类别:category,负责人账号ID:accounts[0].accountId,报名页配置:JSON.stringify({workspaceSubmission:{},center:category,region,approval:{mode:'workspace-regional',region:region==='南京地区'?'nanjing':'suzhou',category,version:'1',levels:{final:{ids:[accounts[0].accountId]}}}})});

async function fixture(run){
 const dir=await mkdtemp(join(tmpdir(),'workspace-role-compat-')),path=join(dir,'roster.json');
 const content=JSON.stringify({version:9,assignments,managedAccountIds:accounts.map(row=>row.accountId)});
 await writeFile(path,content);
 try{await run(path,content);}finally{await rm(dir,{recursive:true,force:true});}
}

test('persisted version 9 role assignments load without rewriting any configuration',()=>fixture(async(path,content)=>{
 const roster=await readWorkspaceRoster(path,accounts);
 assert.equal(roster.complete,true);
 assert.equal(roster.policy,'two-stage');
 assert.equal(roster.rows.length,3);
 const evidence=workspaceRosterEvidence(accounts[0].accountId,'nanjing',roster.rows,{complete:true});
 assert.equal(workspaceLevelAllowed(evidence,'排班类','initial'),true);
 assert.equal(workspaceLevelAllowed(evidence,'排班类','final'),false);
 assert.equal(workspaceLevelAllowed(evidence,'综事中心','final'),true);
 assert.equal(workspaceLevelAllowed(evidence,'生命中心','final'),false);
 assert.equal(workspaceRosterEvidence(accounts[0].accountId,'suzhou',roster.rows,{complete:true}).verified,false);
 assert.equal(await readFile(path,'utf8'),content);
}));

test('role assignments govern approval, draft editing and responsible choices without merging initial and final scopes',()=>fixture(async path=>{
 const roster=await readWorkspaceRoster(path,accounts),actor=accounts[0].accountId;
 const routing=createWorkspaceApprovalRouting({getRoster:async()=>roster});
 assert.equal((await routing.assertReviewer(event(),actor)).reviewerId,actor);
 await assert.rejects(routing.assertReviewer(event('生命中心'),actor),{statusCode:403});
 await assert.rejects(routing.assertReviewer(event('综事中心','苏州地区'),actor),{statusCode:403});
 await assert.rejects(routing.assign(event('排班专项')),{statusCode:409});
}));

test('draft editing and candidate choices retain initial roles for accounts that also have final roles',()=>fixture(async path=>{
 const roster=await readWorkspaceRoster(path,accounts),actor=accounts[0].accountId;
 const draft={ownerId:'other',stage:'草稿',content:{region:'nanjing',category:'排班类',responsibleId:actor}};
 assert.equal(workspaceDraftAccess(draft,actor,roster).canEdit,true);
 assert.equal(workspaceDraftAccess({...draft,content:{...draft.content,responsibleId:'other'}},actor,roster).canEdit,false);
 const ids=workspaceResponsibleOptions(actor,'nanjing','综事中心',roster).map(row=>row.id);
 assert.ok(ids.includes(actor));
 assert.ok(ids.includes(accounts[1].accountId));
}));

test('explicitly managed accounts cannot fall back to old organization permissions after removal',()=>fixture(async path=>{
 const roster=await readWorkspaceRoster(path,accounts);
 const base={query:async()=>{throw Error('must not read legacy organization evidence');}};
 const authority=await organizationAuthority(accounts[1],base,[event('综事中心')],{workspaceRoster:roster});
 authority.assertEvent('synthetic-event');
 assert.throws(()=>authority.assertCreate({center:'综事中心',region:'suzhou'}),{statusCode:403});
 const revoked={...roster,rows:roster.rows.filter(row=>row.accountId!==accounts[1].accountId)};
 const removed=await organizationAuthority(accounts[1],base,[event('综事中心')],{workspaceRoster:revoked});
 assert.equal(removed.canEnter,false);
 assert.throws(()=>removed.assertEvent('synthetic-event'),{statusCode:403});
}));

test('identity revocation and malformed assignments fail closed and leave the file untouched',()=>fixture(async(path,content)=>{
 const roster=await readWorkspaceRoster(path,accounts.map(row=>({...row,status:'停用'})));
 assert.ok(roster.rows.every(row=>!row.active));
 const malformed=JSON.stringify({assignments:[{...assignments[0],roles:['unknown']}]});
 await writeFile(path,malformed);
 await assert.rejects(readWorkspaceRoster(path,accounts),{statusCode:503,code:'workspace_roster_invalid'});
 assert.equal(await readFile(path,'utf8'),malformed);
 assert.notEqual(content,malformed);
}));
