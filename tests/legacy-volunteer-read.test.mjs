import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {displayRead,withDisplayReads,clearDisplayReads,invalidateDisplayReads} from '../lib/http/display-reads.js';
import {registrationReadiness} from '../lib/events/volunteer-workflow.js';

const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const box={displayRead,loadAllRows:(client,table,options)=>readPagedRows(client,table,{requireComplete:true,...options})};
vm.createContext(box);
vm.runInContext(source.slice(source.indexOf('async function volunteerRows('),source.indexOf('function volunteerStatus(')),box);

test('legacy overview reads beyond 5000, preserves linked IDs and coalesces display requests',async()=>{
 clearDisplayReads();
 const rows=Array.from({length:5201},(_,i)=>({_id:`r${i}`,是否报名成功:true,录入状态:'已录入',志愿时长:2}));
 rows[5200]={_id:'r5200',学号:'synthetic-student',是否报名成功:true,录入状态:'待录入',志愿时长:2,签到表:[{row_id:'check',display_value:'display text'}]};
 let calls=0;
 const base={listRows:async(_table,_view,_order,_desc,start,limit)=>{calls++;assert.equal(limit,1000);return rows.slice(start,start+limit);},query:()=>{throw new Error('SQL loses link IDs');}};
 const read=()=>withDisplayReads(()=>box.volunteerRows(base,'活动报名总表'));
 const [a,b]=await Promise.all([read(),read()]);
 assert.equal(a.length,5201);assert.equal(b.length,5201);
 assert.equal(a.readMeta.truncated,false);
 assert.equal(calls,8); // 1 + 1 + 2 + 4 adaptive pages, not repeated per consumer.
 const checkins=new Map([['check',{_id:'check',学号:'synthetic-student',活动名称:[{row_id:'r5200'}]}]]);
 assert.equal(registrationReadiness(a.at(-1),checkins).state,'待录入');
 await read();assert.equal(calls,8);
 invalidateDisplayReads(base,['活动报名总表']);await read();assert.equal(calls,16);
 await box.volunteerRows(base,'活动报名总表');assert.equal(calls,24); // writes never reuse display evidence.
});

test('legacy overview still fails closed when its expanded bound is exceeded',async()=>{
 let calls=0;
 const base={listRows:async(_table,_view,_order,_desc,start,limit)=>{calls++;return Array.from({length:limit},(_,i)=>({_id:`r${start+i}`}));}};
 await assert.rejects(box.volunteerRows(base,'活动报名总表'),{code:'incomplete_operational_data',statusCode:503});
 assert.ok(calls<=102);
});
