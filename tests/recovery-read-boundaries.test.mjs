import test from 'node:test';
import assert from 'node:assert/strict';
import {scopedRows} from '../lib/events/scoped-read.js';
import {withDisplayReads,clearDisplayReads,invalidateDisplayReads} from '../lib/http/display-reads.js';
import {createPublicReadCache} from '../public/app/core/public-read-cache.js';

test('current activity evidence queries stay scoped and mutations bypass restored display caches',async()=>{
 const table='网站活动报名总表',queries=[];
 let revision=1;
 const base={
  listRows:async()=>assert.fail('an activity detail must not scan all registrations'),
  query:async sql=>{queries.push(sql);assert.match(sql,/WHERE `活动ID` IN \('WF-selected'\)/);return [{_id:'selected',活动ID:'WF-selected',revision}];},
 };
 clearDisplayReads();
 try{
  await withDisplayReads(async()=>{
   assert.equal((await scopedRows(base,table,['WF-selected']))[0].revision,1);
   await scopedRows(base,table,['WF-selected']);assert.equal(queries.length,1);
  });
  revision=2;
  assert.equal((await scopedRows(base,table,['WF-selected']))[0].revision,2);
  assert.equal(queries.length,2);
  invalidateDisplayReads([table]);
  await withDisplayReads(async()=>assert.equal((await scopedRows(base,table,['WF-selected']))[0].revision,2));
  assert.equal(queries.length,3);
 }finally{clearDisplayReads();}
});

test('restored client stale refresh cannot overwrite evidence after a foreground write',async()=>{
 let time=0,finishOld;
 const cache=createPublicReadCache({ttlMs:10,maxAgeMs:30,now:()=>time});
 await cache.get('workspace',async()=>({version:1}));time=11;
 assert.deepEqual(await cache.get('workspace',()=>new Promise(resolve=>{finishOld=resolve;})),{version:1});
 cache.clear();
 assert.deepEqual(await cache.get('workspace',async()=>({version:2})),{version:2});
 finishOld({version:1});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await cache.get('workspace',()=>assert.fail('the post-write evidence must stay cached')),{version:2});
});
