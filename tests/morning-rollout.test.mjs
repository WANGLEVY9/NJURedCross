import test from 'node:test';
import assert from 'node:assert/strict';
import { MORNING_SCHEMA } from '../lib/morning/schema.js';
import { inspectMorningSchema, planMorningSchema } from '../lib/morning/rollout.js';
test('Morning schema plan is additive, resumable and checks column types',()=>{
 const empty={tables:[]};assert.equal(planMorningSchema(empty).filter(t=>t.create).length,6);
 const complete={tables:MORNING_SCHEMA.map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'}))}))};
 assert.equal(inspectMorningSchema(complete).ready,true);
 assert.ok(planMorningSchema(complete).every(t=>!t.create&&!t.columns.length));
 const partial=structuredClone(complete);partial.tables[0].columns.pop();
 assert.equal(inspectMorningSchema(partial).ready,false);
 assert.equal(planMorningSchema(partial)[0].columns.length,1);
 partial.tables[0].columns[0].type='number';assert.throws(()=>planMorningSchema(partial),/type_mismatch/);
});

test('morning readiness rejects mistyped or unknown columns while ignoring unrelated extras', () => {
 for (const type of ['date', 'number', 'single-select', undefined]) {
  const metadata={tables:MORNING_SCHEMA.map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'}))}))};
  const column=metadata.tables.find(table=>table.name==='早安晚安邀约表').columns.find(column=>column.name==='过期时间');
  column.type=type;
  const result=inspectMorningSchema(metadata);
  assert.equal(result.ready,false);
  assert.deepEqual(result.checks.find(check=>check.name==='早安晚安邀约表').invalidColumns,[{name:'过期时间',expected:'text',actual:type??null}]);
 }
 const metadata={tables:MORNING_SCHEMA.map(t=>({name:t.name,columns:t.columns.map(name=>({name,type:'text'}))}))};
 metadata.tables[0].columns.push({name:'管理员自定义字段',type:'date'});
 assert.equal(inspectMorningSchema(metadata).ready,true);
});
