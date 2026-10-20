import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRunningFile,matchRunningImport} from '../lib/events/running-import.js';
import {hoursWorkbook} from '../lib/events/hours-workbook.js';
const csv='姓名,学号,服务时长,培训时长,交通时长,岗位\n合成甲,20300001,2,0,0,接待岗\n';
test('CSV reads literal values in bounded worker and rejects missing hours rather than assuming zero',async()=>{
 const rows=await parseRunningFile({name:'合成.csv',bytes:Buffer.from(csv).toString('base64')});assert.equal(rows[0]['学号'],'20300001');assert.equal(rows[0]['培训时长'],'0');
 await assert.rejects(parseRunningFile({name:'合成.csv',bytes:Buffer.from('姓名,学号,服务时长\n合成甲,20300001,2').toString('base64')}),/表头/);
 assert.throws(()=>parseRunningFile({name:'fake.xls',bytes:'YQ=='}),{statusCode:400});
});
test('exact identity and position disambiguate repeated person; changed hours clear prior review',()=>{
 const regs=[{_id:'1',活动ID:'a',姓名:'合成甲',学号:'20300001'},{_id:'2',活动ID:'b',姓名:'合成甲',学号:'20300001'}],events=[{活动ID:'a',岗位:'接待岗'},{活动ID:'b',岗位:'培训岗'}];
 const row={姓名:'合成甲',学号:'20300001',服务时长:'2',培训时长:'0',交通时长:'0'};
 assert.throws(()=>matchRunningImport([row],regs,events),/唯一匹配/);
 assert.throws(()=>matchRunningImport([{...row,岗位:'接待岗'}],regs,events),/全部岗位/);
 const result=matchRunningImport([{...row,岗位:'接待岗'},{...row,岗位:'培训岗'}],regs,events,[{id:'1',serviceHours:3,trainingHours:0,travelHours:0,decision:'pass',evidenceChecked:true}]);
 assert.deepEqual(result.map(item=>item.id),['1','2']);assert.equal(result[0].decision,'');assert.equal(result[0].evidenceChecked,false);
 assert.throws(()=>matchRunningImport([{...row,岗位:'接待岗'},{...row,岗位:'接待岗'}],regs,events),/唯一匹配/);
});
test('existing XLSX export can be read as values and CSV preserves leading-zero student IDs',async()=>{
 const bytes=await hoursWorkbook({rows:[{姓名:'合成甲',学号:'00123456',服务时长:2,培训时长:0,交通时长:0}]});
 const rows=await parseRunningFile({name:'合成.xlsx',bytes:bytes.toString('base64')});assert.equal(rows[0]['学号'],'00123456');assert.equal(rows[0]['服务时长'],'2');
 const csvRows=await parseRunningFile({name:'合成.csv',bytes:Buffer.from(csv.replace('20300001','00123456')).toString('base64')});assert.equal(csvRows[0]['学号'],'00123456');
});
