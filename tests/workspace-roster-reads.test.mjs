import {projectEventSessionAccess} from '../lib/events/event-session-access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createWorkspaceRosterProvider} from '../lib/events/workspace-providers.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {withDisplayReads,clearDisplayReads,invalidateDisplayReads,isDisplayRequest} from '../lib/http/display-reads.js';
import {ACCOUNT_TABLE} from '../lib/identity/store.js';
import {withoutRequestBudget,withRequestBudget,awaitWithinRequest} from '../lib/http/request-budget.js';

const account={accountId:'synthetic-chair',role:'platform_admin',permissions:['events'],emailVerified:true,status:'启用'};
const configuration=roles=>JSON.stringify({assignments:[{accountId:account.accountId,roles,finalCategories:['综事中心']}]});
async function fixture(run){
 clearDisplayReads();
 const directory=await mkdtemp(join(tmpdir(),'roster-reads-')),path=join(directory,'roster.json');
 await writeFile(path,configuration(['R01','R05']));
 try{await run(path);}finally{clearDisplayReads();await rm(directory,{recursive:true,force:true});}
}

test('six drafts and parallel workspace reads share one account-table load',()=>fixture(async path=>{
 let loads=0;
 const base={},provider=createWorkspaceRosterProvider({getIdentityBase:async()=>base,getPath:()=>path,loadAccounts:async()=>{loads++;return new Map([[account.accountId,account]]);}});
 const drafts=createWorkspaceDrafts({readById:async()=>[],readByRequest:async()=>[],readCandidates:async()=>Array.from({length:6},(_,id)=>({id:String(id),content:{},ownerId:account.accountId,stage:'草稿'})),append:async()=>{},update:async()=>{},queue:task=>task(),authorize:()=>provider(),getAccess:async()=>{await provider();return {canView:true};}});
 const [list]=await Promise.all([withDisplayReads(()=>drafts.list(account.accountId)),withDisplayReads(()=>provider()),withDisplayReads(()=>provider())]);
 assert.equal(list.length,6);
 assert.equal(loads,1,'permission checks and per-draft presentation must not scan accounts repeatedly');
}));

test('account writes invalidate display rows while mutations bypass cached account status',()=>fixture(async path=>{
 let loads=0,status='启用';const base={};
 const provider=createWorkspaceRosterProvider({getIdentityBase:async()=>base,getPath:()=>path,loadAccounts:async()=>{loads++;return new Map([[account.accountId,{...account,status}]]);}});
 assert.equal((await withDisplayReads(provider)).rows[0].active,true);
 status='停用';
 assert.equal((await provider()).rows[0].active,false);
 invalidateDisplayReads([ACCOUNT_TABLE]);
 assert.equal((await withDisplayReads(provider)).rows[0].active,false);
 assert.equal(loads,3);
}));

test('permission file edits take effect within the same account snapshot and failed loads can recover',()=>fixture(async path=>{
 let loads=0,fail=true;const base={};
 const provider=createWorkspaceRosterProvider({getIdentityBase:async()=>base,getPath:()=>path,loadAccounts:async()=>{loads++;if(fail)throw Error('synthetic upstream unavailable');return new Map([[account.accountId,account]]);}});
 await assert.rejects(withDisplayReads(provider));fail=false;
 assert.equal((await withDisplayReads(provider)).rows[0].role,'presidium');
 await writeFile(path,configuration(['R01']));
 assert.equal((await withDisplayReads(provider)).rows[0].role,'director');
 assert.equal(loads,2);
}));

test('zero account refresh window disables snapshots even in a display GET',()=>fixture(async path=>{
 let loads=0;const base={};
 const provider=createWorkspaceRosterProvider({getIdentityBase:async()=>base,getPath:()=>path,ttlMs:()=>0,loadAccounts:async()=>{loads++;return new Map([[account.accountId,account]]);}});
 await withDisplayReads(async()=>{await provider();await provider();});
 assert.equal(loads,2);
}));

test('workspace and session snapshots apply to GET only, never login or mutations',()=>{
 for(const path of ['/api/auth/session','/api/volunteer/workflow/workspace-drafts','/api/volunteer/workflow/workspace-drafts/capabilities','/api/volunteer/workflow/workspace-drafts/synthetic']){
  assert.equal(isDisplayRequest('GET',path),true);
  for(const method of ['POST','PATCH','DELETE'])assert.equal(isDisplayRequest(method,path),false);
 }
 assert.equal(isDisplayRequest('POST','/api/auth/login'),false);
});

test('verified super-admin session does not depend on reading the full activity directory',async()=>{
 const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
 const text=source.slice(source.indexOf('async function eventSessionPayload('),source.indexOf('async function authApi('));
 let reads=0;const box={projectEventSessionAccess,organizationEvents:true,sessionPayload:session=>({user:{role:session.role,permissions:session.role==='member'?[]:['events']}}),eventAuthority:async()=>{reads++;throw Error('synthetic activity outage');}};
 vm.createContext(box);vm.runInContext(text+';globalThis.payload=eventSessionPayload;',box);
 const admin=await box.payload({role:'super_admin'});
 assert.equal(reads,0);assert.equal(admin.user.permissions[0],'events');
 const member=await box.payload({role:'member'});
 assert.equal(reads,1);assert.equal(member.user.eventAuthorityUnavailable,true);assert.equal(member.user.permissions.length,0);
});

test('concurrent session GETs share one fresh lookup; cancelling one caller does not poison another',async()=>{
 const source=(await readFile(new URL('../server.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 const definitions=source.match(/const accountRefreshCache=new Map\(\);[\s\S]*?\n(?=\/\*\* 账号)/)[0];
 let loads=0,finish;
 const lookup=async()=>{loads++;if(loads===1)return new Promise(resolve=>{finish=resolve;});return {revision:loads};};
 const state=new Function('findAccountByLogin','getIdentityBase','accountRefreshTtlMs','withoutRequestBudget','withRequestBudget','awaitWithinRequest',`${definitions};return {loadSessionAccount};`)(lookup,async()=>({}),()=>5000,withoutRequestBudget,withRequestBudget,awaitWithinRequest);
 const controller=new AbortController();
 const first=assert.rejects(withRequestBudget(()=>state.loadSessionAccount('shared',{allowCache:true}),{signal:controller.signal}),{code:'external_request_cancelled'});
 const second=withRequestBudget(()=>state.loadSessionAccount('shared',{allowCache:true}));
 await Promise.resolve();await Promise.resolve();
 controller.abort(new Error('synthetic caller cancelled'));await first;
 assert.equal(loads,1);finish({revision:1});assert.deepEqual(await second,{revision:1});
 assert.deepEqual(await state.loadSessionAccount('shared'),{revision:2},'writes still read their own fresh account');
});
