import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceDraftAccess,createWorkspaceDraftAuthorization} from '../lib/events/workspace-draft-access.js';
const roster={complete:true,rows:[{accountId:'creator',region:'nanjing',role:'director',active:true,categories:['生命中心']},{accountId:'responsible',region:'nanjing',role:'director',active:true,categories:['生命中心']},{accountId:'chair',region:'nanjing',role:'presidium',active:true,categories:[]},{accountId:'foreign-chair',region:'suzhou',role:'presidium',active:true,categories:[]}]};
const row={ownerId:'creator',stage:'草稿',content:{region:'nanjing',category:'生命中心',responsibleId:'responsible'}};
test('draft handoff grants the selected director and regional presidium fresh edit authority',async()=>{
 for(const actor of ['responsible','chair'])assert.deepEqual(workspaceDraftAccess(row,actor,roster),{canView:true,canEdit:true});
 assert.deepEqual(workspaceDraftAccess(row,'creator',roster),{canView:true,canEdit:false});
 assert.deepEqual(workspaceDraftAccess(row,'foreign-chair',roster),{canView:false,canEdit:false});
 const authorize=createWorkspaceDraftAuthorization({actor:'chair',getRoster:async()=>roster});await authorize(row,'chair','edit');
 await assert.rejects(authorize(row,'responsible','edit'),{statusCode:403});
 assert.equal(workspaceDraftAccess({...row,submission:{status:'claimed'}},'chair',roster).canEdit,false);
 const revoked={...roster,rows:roster.rows.map(r=>r.accountId==='chair'?{...r,active:false}:r)};
 assert.equal(workspaceDraftAccess(row,'chair',revoked).canView,false);
 assert.equal(workspaceDraftAccess(row,'chair',{...roster,complete:false}).canView,false);
});

test('creator keeps a private unassigned draft editable while the trusted roster is incomplete',async()=>{
 const privateRow={ownerId:'creator',stage:'草稿',content:{region:'nanjing',category:'生命中心',responsibleId:''}};
 const incomplete={complete:false,rows:[]};
 assert.deepEqual(workspaceDraftAccess(privateRow,'creator',incomplete),{canView:true,canEdit:true});
 assert.deepEqual(workspaceDraftAccess(privateRow,'other',incomplete),{canView:false,canEdit:false});
 let createInput;
 const authorize=createWorkspaceDraftAuthorization({actor:'creator',getRoster:async()=>incomplete,assertCreate:input=>{createInput=input;}});
 await authorize(privateRow,'creator','create');
 assert.deepEqual(createInput,{center:'生命中心',region:'nanjing'});
 assert.equal(workspaceDraftAccess({...privateRow,content:{...privateRow.content,responsibleId:'responsible'}},'creator',incomplete).canEdit,false);
});
