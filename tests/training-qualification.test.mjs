import test from 'node:test';
import assert from 'node:assert/strict';
import {isApprovedOnePlusTraining,upgradeTrainingQualification} from '../lib/identity/training-qualification.js';
import {CERTIFICATE_OPTIONS as choices} from '../public/app/shared/certificates.js';
const source={key:'FINAL:r',activityName:'11.8 一加·急救培训',name:'合成同学',studentId:'999990001',totalHours:3};
function fixture(certificate='否'){
 let rows=[{_id:'profile',姓名:source.name,学号:source.studentId,急救证:certificate}],writes=[],reads=0;
 const column={name:'急救证',type:'single-select',data:{options:choices.map(name=>({name}))}};
 const base={query:async()=>{reads++;return structuredClone(rows);},getMetadata:async()=>({tables:[{name:'个人主页（编辑版）',columns:[column]}]}),updateRow:async(table,id,patch)=>{assert.equal(table,'个人主页（编辑版）');assert.equal(id,'profile');writes.push(patch);Object.assign(rows[0],patch);}};
 return {base,writes,column,get reads(){return reads;},setRows:value=>{rows=value;}};
}
test('only final approved positive One Plus training sources qualify',()=>{
 assert.equal(isApprovedOnePlusTraining(source),true);
 for(const patch of [{key:'RUNNING:r'},{key:'SERVICE:r'},{totalHours:0},{activityName:'一加助残活动'},{activityName:'校医院急救培训'}])assert.equal(isApprovedOnePlusTraining({...source,...patch}),false);
});
test('no certificate upgrades once to the existing One Plus option without schema writes',async()=>{
 const f=fixture();assert.equal((await upgradeTrainingQualification(f.base,source)).status,'updated');assert.deepEqual(f.writes,[{急救证:choices[3]}]);assert.equal((await upgradeTrainingQualification(f.base,source)).status,'unchanged');assert.equal(f.writes.length,1);
});
test('existing One Plus CPR and AHA qualifications as well as unknown values stay unchanged',async()=>{
 for(const value of [...choices.filter(value=>value!=='否'),'是，CPR+AED/红十字救护证','','未知']){const f=fixture(value);assert.equal((await upgradeTrainingQualification(f.base,source)).status,'unchanged');assert.equal(f.writes.length,0);}
});
test('identity conflicts, missing source options and incomplete queries fail without writes',async()=>{
 for(const rows of [[],[{_id:'profile',姓名:'其他同学',学号:source.studentId,急救证:'否'}],[{_id:'a',姓名:source.name,学号:source.studentId},{_id:'b',姓名:source.name,学号:source.studentId}]]){const f=fixture();f.setRows(rows);await assert.rejects(upgradeTrainingQualification(f.base,source));assert.equal(f.writes.length,0);}
 const f=fixture();f.column.data.options=[{name:'否'}];await assert.rejects(upgradeTrainingQualification(f.base,source));assert.equal(f.writes.length,0);
});
test('source qualification upgraded while metadata loads is never downgraded',async()=>{
 const f=fixture(),getMetadata=f.base.getMetadata;f.base.getMetadata=async()=>{f.setRows([{_id:'profile',姓名:source.name,学号:source.studentId,急救证:choices[0]}]);return getMetadata();};assert.equal((await upgradeTrainingQualification(f.base,source)).status,'unchanged');assert.equal(f.writes.length,0);
});
