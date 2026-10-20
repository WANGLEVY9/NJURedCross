import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeWorkspaceDraft} from '../public/app/shared/activity-workspace.js';
import {createApprovalRoutingStore} from '../lib/events/approval-routing-store.js';
import {compileWorkspaceRoster} from '../lib/events/workspace-providers.js';
import {workspaceRosterEvidence} from '../lib/events/workspace-roster.js';
import {workspaceDraftAccess} from '../lib/events/workspace-draft-access.js';
import {createWorkspaceApprovalRouting} from '../lib/events/workspace-approval-routing.js';
import {createApprovalRouting} from '../lib/events/approval-routing.js';

test('historical scheduling names retain draft access and regional roster identity',()=>{
 const rows=[{accountId:'owner',region:'nanjing',role:'director',categories:['排班类']}];
 const accounts=[{accountId:'owner',active:true,emailVerified:true,studentId:'999990001'}];
 const compiled=compileWorkspaceRoster({rows},accounts).rows;
 assert.deepEqual(compiled[0].categories,['排班专项']);assert.deepEqual(rows[0].categories,['排班类']);
 const roster={complete:true,rows:compiled};
 assert.equal(workspaceRosterEvidence('owner','nanjing',compiled,{complete:true}).verified,true);
 for(const category of ['排班类','排版类','排班专项']){
  assert.equal(normalizeWorkspaceDraft({name:'合成',region:'nanjing',category}).category,'排班专项');
  assert.equal(workspaceDraftAccess({ownerId:'owner',stage:'草稿',content:{region:'nanjing',category,responsibleId:'owner'}},'owner',roster).canEdit,true);
 }
 assert.throws(()=>compileWorkspaceRoster({rows:[{...rows[0],categories:['排班类','排班专项']}]},accounts),/类别无效/);
});

test('reading historical reviewer mappings preserves the saved file and reviewer',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'scheduling-rename-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const file=join(folder,'synthetic.json'),source=JSON.stringify({version:3,mappings:{'排班类':'chair'}});await writeFile(file,source);
 const result=await createApprovalRoutingStore(file).read();
 assert.equal(result.version,3);assert.equal(result.mappings['排班专项'],'chair');assert.equal(await readFile(file,'utf8'),source);
});

test('in-flight regional and legacy approvals keep their original reviewer after the rename',async()=>{
 const approval={mode:'workspace-regional',region:'nanjing',category:'排班类',version:'1',reviewerIds:['chair']};
 const event={状态:'待审核',申请版本:'1',组织类别:'排班类',活动地区:'南京地区',报名页配置:JSON.stringify({center:'排班类',region:'南京活动',approval})};
 const regional=createWorkspaceApprovalRouting({getRoster:async()=>({complete:true,rows:[{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:[]}]})});
 assert.equal((await regional.assertReviewer(event,'chair')).reviewerId,'chair');
 await assert.rejects(regional.assertReviewer(event,'other'),{statusCode:403});
 const legacy=createApprovalRouting({store:{},getAccounts:async()=>[{accountId:'chair',role:'platform_admin',permissions:['events']}]});
 assert.equal((await legacy.assertReviewer(event,'chair')).reviewerId,'chair');
 await assert.rejects(legacy.assertReviewer(event,'other'),{statusCode:403});
});
