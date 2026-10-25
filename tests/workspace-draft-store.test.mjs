import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
const row=()=>({id:'draft-1',ownerId:'owner',requestId:'synthetic-request',version:1,stage:'草稿',content:{name:'合成'},preview:null});
test('persistent private drafts survive closing and reopening the store',()=>{
 const dir=mkdtempSync(join(tmpdir(),'activity-drafts-')),path=join(dir,'drafts.sqlite');let store;
 try{store=openWorkspaceDraftStore(path);store.append(row());store.close();store=openWorkspaceDraftStore(path);assert.deepEqual(store.read(),[row()]);}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('independent store connections reject stale writes and preserve the winning version',()=>{
 const dir=mkdtempSync(join(tmpdir(),'activity-drafts-')),path=join(dir,'drafts.sqlite');const a=openWorkspaceDraftStore(path),b=openWorkspaceDraftStore(path);
 try{a.append(row());a.update('draft-1',{version:2,content:{name:'获胜版本'}},1);assert.throws(()=>b.update('draft-1',{version:2,content:{name:'旧版本覆盖'}},1),e=>e.statusCode===409);assert.throws(()=>b.update('draft-1',{preview:{digest:'旧预览'}},1),e=>e.statusCode===409);assert.equal(b.read()[0].content.name,'获胜版本');assert.equal(b.read()[0].preview,null);}finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('storage rejects ownership replacement, revision rollback and duplicated creation identity',()=>{
 const s=openWorkspaceDraftStore(':memory:');try{s.append(row());assert.throws(()=>s.update('draft-1',{ownerId:'attacker'},1),e=>e.statusCode===409);assert.throws(()=>s.update('draft-1',{version:0},1),e=>e.statusCode===409);assert.throws(()=>s.append({...row(),id:'other'}),e=>e.code==='workspace_duplicate_request');assert.deepEqual(s.read(),[row()]);}finally{s.close();}
});
test('draft service uses durable CAS for save and preview confirmation',async()=>{
 const s=openWorkspaceDraftStore(':memory:');let tail=Promise.resolve();
 const service=createWorkspaceDrafts({...s,queue:fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;},authorize:async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(Error('forbidden'),{statusCode:403});}});
 try{const a=await service.create({requestId:'synthetic-request-key',content:{name:'仅名称'}},'owner');assert.equal((await service.list('other')).length,0);const p=await service.preview(a.id,{expectedVersion:1},'owner');await service.save(a.id,{expectedVersion:1,content:{name:'修改'}},'owner');await assert.rejects(service.confirmPreview(a.id,{expectedVersion:1,digest:p.digest},'owner'),e=>e.statusCode===409);}finally{s.close();}
});
