import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {withoutRequestBudget,withRequestBudget,currentRequestBudget} from '../lib/http/request-budget.js';

// Exercise the actual production adapter without starting the HTTP server or SMTP.
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const expression=source.match(/schedule:(task=>setImmediate[^\n]+?),onError:/)?.[1];
assert.ok(expression,'production decision-mail scheduler must be present');
function adapter(warnings){return runInNewContext(`(${expression})`,{setImmediate,withoutRequestBudget,console:{warn:message=>warnings.push(message)}});}
const settled=()=>new Promise(resolve=>setTimeout(resolve,15));

test('production decision-mail scheduler accepts the worker void callback outside request budgets',async()=>{
 const warnings=[],schedule=adapter(warnings);let called=0,budget;
 await withRequestBudget(async()=>{schedule(()=>{called++;budget=currentRequestBudget();});});
 await settled();assert.equal(called,1);assert.equal(budget,undefined);assert.deepEqual(warnings,[]);
});

test('production decision-mail scheduler contains both synchronous throws and rejected promises',async()=>{
 const warnings=[],schedule=adapter(warnings);
 schedule(()=>{throw Error('synthetic synchronous failure');});
 schedule(()=>Promise.reject(Error('synthetic asynchronous failure')));
 await settled();assert.equal(warnings.length,2);assert.ok(warnings.every(message=>message==='Activity decision mail deferred'));
});
