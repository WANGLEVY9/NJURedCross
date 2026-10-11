import test from 'node:test';
import assert from 'node:assert/strict';
import { MORNING_SCHEMA } from '../lib/morning/schema.js';
import { inspectMorningSchema, planMorningSchema } from '../lib/morning/rollout.js';
test('Morning schema plan is additive, resumable and checks column types',()=>{
 const empty={tables:[]};assert.equal(planMorningSchema(empty).filter(t=>t.create).length,4);
 const complete={tables:MORNING_SCHEMA.map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'}))}))};
 assert.equal(inspectMorningSchema(complete).ready,true);
 assert.ok(planMorningSchema(complete).every(t=>!t.create&&!t.columns.length));
 const partial=structuredClone(complete);partial.tables[0].columns.pop();
 assert.equal(inspectMorningSchema(partial).ready,false);
 assert.equal(planMorningSchema(partial)[0].columns.length,1);
 partial.tables[0].columns[0].type='number';assert.throws(()=>planMorningSchema(partial),/type_mismatch/);
});
