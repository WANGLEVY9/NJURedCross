import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=(await readFile(new URL('../server.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
const start=source.indexOf('async function getVolunteerPlatformBase()'),end=source.indexOf('function volunteerPlatformCacheTtlMs()',start);
assert.ok(start>=0&&end>start);
function reader({mode='production',configured='production-base',actual=configured,authoritative='production-base',connected=true}={}){
 const calls=[],primary={dtableUuid:authoritative},mirror={dtableUuid:actual};
 const fn=vm.runInNewContext(`(${source.slice(start,end).trim()})`,{process:{env:{PLATFORM_WORKFLOW_MODE:mode}},workflowMode:()=>({expected:'production-base'}),volunteerPlatformBaseUuid:configured,volunteerPlatformAccess:connected?async()=>{calls.push('mirror');return mirror;}:null,getVolunteerBase:async()=>{calls.push('authoritative');return primary;},Error});
 return {fn,calls,primary,mirror};
}
test('member profile reads the posting Base when the old optional mirror is absent or points elsewhere',async()=>{
 for(const options of [{connected:false},{configured:'other-base'}]){const r=reader(options);assert.equal(await r.fn(),r.primary);assert.deepEqual(r.calls,['authoritative']);}
});
test('matching readonly credentials remain preferred, and actual Base identity mismatches are rejected',async()=>{
 const r=reader();assert.equal(await r.fn(),r.mirror);assert.deepEqual(r.calls,['mirror']);
 await assert.rejects(reader({actual:'wrong-base'}).fn(),/mismatch/);await assert.rejects(reader({connected:false,authoritative:'wrong-base'}).fn(),/mismatch/);
});
test('non-production optional profile reads retain their existing disconnected behavior',async()=>{
 const r=reader({mode:'test',connected:false});assert.equal(await r.fn(),null);assert.deepEqual(r.calls,[]);
});
