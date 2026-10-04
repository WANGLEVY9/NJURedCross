import test from 'node:test';
import assert from 'node:assert/strict';
import { withDisplayReads, displayRead, clearDisplayReads } from '../lib/http/display-reads.js';

test('display queries coalesce only for the same Base and key', async () => {
  clearDisplayReads();
  const a = {}, b = {}; let calls = 0;
  const read = base => withDisplayReads(() => displayRead(base, 'rows', async () => ++calls));
  assert.deepEqual(await Promise.all([read(a), read(a)]), [1, 1]);
  assert.equal(await read(b), 2);
});

test('mutation and authorization reads bypass display snapshots', async () => {
  clearDisplayReads(); const base = {}; let value = 'before';
  const load = () => Promise.resolve(value);
  assert.equal(await withDisplayReads(() => displayRead(base, 'rows', load)), 'before');
  value = 'after';
  assert.equal(await displayRead(base, 'rows', load), 'after');
  assert.equal(await withDisplayReads(() => displayRead(base, 'rows', load)), 'before');
  clearDisplayReads();
  assert.equal(await withDisplayReads(() => displayRead(base, 'rows', load)), 'after');
});

test('invalidated in-flight display results cannot populate the new generation', async () => {
  clearDisplayReads(); const base = {}; let finish;
  const old = withDisplayReads(() => displayRead(base, 'rows', () => new Promise(resolve => { finish = resolve; })));
  await Promise.resolve(); clearDisplayReads();
  assert.equal(await withDisplayReads(() => displayRead(base, 'rows', () => 'new')), 'new');
  finish('old'); await old;
  assert.equal(await withDisplayReads(() => displayRead(base, 'rows', () => 'wrong')), 'new');
});

test('500-row pages retain every row and reduce large-table round trips', async () => {
  const {readFile} = await import('node:fs/promises'); const vm = await import('node:vm');
  const source = await readFile(new URL('../server.js',import.meta.url),'utf8');
  const text=source.slice(source.indexOf('async function listAllRows('),source.indexOf('function reviewFromRow('));
  const calls=[], rows=Array.from({length:1201},(_,i)=>({_id:String(i)}));
  const client={listRows:async(_table,_view,_order,_column,start,limit)=>{calls.push([start,limit]);return rows.slice(start,start+limit);}};
  const box={displayRead:(_base,_key,load)=>load(),httpError:(_status,message)=>new Error(message)};
  vm.createContext(box);vm.runInContext(text+';globalThis.list=listAllRows;',box);
  const result=await box.list(client,'activities');
  assert.equal(result.length,1201);assert.equal(result.readMeta.truncated,false);
  assert.deepEqual(calls,[[0,500],[500,500],[1000,500]]);
});

test('notification queries only load modules granted to the current account', async () => {
  const {readFile} = await import('node:fs/promises'); const vm = await import('node:vm');
  const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
  const text=source.slice(source.indexOf('async function getNotificationsOverview('),source.indexOf('async function getEventsOverview('));
  const calls=[];const load=name=>async()=>{calls.push(name);return{};};
  const box={CONSOLE_PERMISSION_SCOPES:[],normalizePermissions:value=>value,volunteerBase:true,getVolunteerBase:async()=>({}),
    getMaterialsOverview:load('materials'),getEventsOverview:load('events'),getOutreachOverview:load('outreach'),getVolunteerOverview:load('volunteer'),
    readCommunitySubmissions:load('community'),readPublicSubmissions:load('public-submissions'),readWarmthInterests:load('warmth')};
  vm.createContext(box);vm.runInContext(text+';globalThis.load=getNotificationsOverview;',box);
  const payload=await box.load({},['events']);
  assert.deepEqual(calls.sort(),['events','volunteer']);assert.equal(payload.stats.total,0);
});
