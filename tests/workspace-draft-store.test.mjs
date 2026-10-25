import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWorkspaceDraftStore} from '../lib/events/workspace-draft-store.js';
import {createWorkspaceDrafts} from '../lib/events/workspace-drafts.js';
import {DatabaseSync} from 'node:sqlite';
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

test('draft id and request lookups use indexes and never parse unrelated payloads',()=>{
 const dir=mkdtempSync(join(tmpdir(),'activity-draft-indexes-')),path=join(dir,'drafts.sqlite');
 const store=openWorkspaceDraftStore(path),db=new DatabaseSync(path);
 try{
  store.append(row());
  db.prepare('INSERT INTO activity_workspace_drafts(id,owner_id,request_id,version,data) VALUES(?,?,?,?,?)').run('unrelated','other','other-request',1,'invalid unrelated JSON');
  assert.deepEqual(store.readById('draft-1'),[row()]);
  assert.deepEqual(store.readByRequest('owner','synthetic-request'),[row()]);
  assert.deepEqual(store.readById('missing'),[]);
  assert.deepEqual(store.readByRequest('other','synthetic-request'),[]);
  assert.deepEqual(store.readById("draft-1' OR 1=1 --"),[]);
  for(const [sql,args] of [
   ['SELECT data FROM activity_workspace_drafts WHERE id=?',['draft-1']],
   ['SELECT data FROM activity_workspace_drafts WHERE owner_id=? AND request_id=?',['owner','synthetic-request']],
  ]){
   const plan=db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row=>row.detail).join(' ');
   assert.match(plan,/SEARCH .* USING INDEX/);assert.doesNotMatch(plan,/\bSCAN\b/);
  }
 }finally{db.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('create, replay, edit, preview, copy and removal never use an unscoped draft read',async()=>{
 const store=openWorkspaceDraftStore(':memory:');let tail=Promise.resolve();
 const service=createWorkspaceDrafts({...store,read:()=>{throw Error('unscoped draft read');},queue:task=>{const next=tail.then(task);tail=next.catch(()=>{});return next;},authorize:async(row,actor)=>{if(row.ownerId!==actor)throw Object.assign(Error('forbidden'),{statusCode:403});}});
 try{
  const input={requestId:'synthetic-indexed-create',content:{name:'定向草稿'}};
  const created=await service.create(input,'owner');assert.equal((await service.create(input,'owner')).id,created.id);
  await assert.rejects(service.get(created.id,'other'),{statusCode:403});
  const saved=await service.save(created.id,{expectedVersion:1,content:{name:'定向修改'}},'owner');
  const preview=await service.preview(created.id,{expectedVersion:2},'owner');
  await service.confirmPreview(created.id,{expectedVersion:2,digest:preview.digest},'owner');
  assert.equal((await service.get(created.id,'owner')).content.name,saved.content.name);
  const copyArgs={requestId:'synthetic-indexed-copy',expectedVersion:2};
  const copied=await service.copy(created.id,copyArgs,'owner');assert.equal((await service.copy(created.id,copyArgs,'owner')).id,copied.id);
  await service.remove(copied.id,{expectedVersion:1,requestId:'synthetic-indexed-remove'},'owner');
  await assert.rejects(service.get(copied.id,'owner'),{statusCode:410});
 }finally{store.close();}
});

test('draft list candidates use active owner and region indexes and exclude unrelated corrupt payloads',()=>{
 const dir=mkdtempSync(join(tmpdir(),'activity-draft-list-')),path=join(dir,'drafts.sqlite');
 const store=openWorkspaceDraftStore(path),db=new DatabaseSync(path);
 try{
  store.append({...row(),content:{region:'nanjing'}});
  store.append({...row(),id:'regional',ownerId:'another',requestId:'regional',content:{region:'nanjing'}});
  store.append({...row(),id:'removed',requestId:'removed',removal:{actor:'owner'},content:{region:'nanjing'}});
  db.prepare('INSERT INTO activity_workspace_drafts VALUES(?,?,?,?,?)').run('unrelated','other','other',1,'invalid unrelated JSON');
  assert.deepEqual(store.readCandidates({ownerId:'owner',regions:['nanjing']}).map(r=>r.id),['draft-1','regional']);
  assert.deepEqual(store.readCandidates({ownerId:'missing',regions:[]}),[]);
  const active="CASE WHEN json_valid(data) THEN json_extract(data,'$.removal') END IS NULL";
  const region="CASE WHEN json_valid(data) THEN json_extract(data,'$.content.region') END";
  for(const [condition,args,index] of [
   ['owner_id=?',['owner'],'workspace_drafts_active_owner'],
   [`(${region})=?`,['nanjing'],'workspace_drafts_active_region'],
  ]){
   const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT data FROM activity_workspace_drafts WHERE ${active} AND ${condition}`).all(...args).map(r=>r.detail).join(' ');
   assert.match(plan,new RegExp(`SEARCH .* USING INDEX ${index}`));assert.doesNotMatch(plan,/\bSCAN\b/);
  }
  assert.throws(()=>store.readCandidates({ownerId:'owner',regions:['untrusted']}));
  db.prepare('DELETE FROM activity_workspace_drafts WHERE id=?').run('unrelated');
  assert.deepEqual(store.readCandidates({ownerId:'global',all:true}).map(r=>r.id),['draft-1','regional']);
 }finally{db.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
