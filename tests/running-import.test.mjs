import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseRunningFile,matchRunningImport} from '../lib/events/running-import.js';
import {hoursWorkbook} from '../lib/events/hours-workbook.js';
import {runningTemplateWorkbook,RUNNING_TEMPLATE_COLUMNS} from '../lib/events/running-template.js';
const csv='姓名,学号,服务时长,培训时长,交通时长,岗位\n合成甲,20300001,2,0,0,接待岗\n';
const upload=async buffer=>parseRunningFile({name:'合成.xlsx',bytes:buffer.toString('base64')});
async function sheetBytes(header,rows){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('合成');
 sheet.addRow(header);for(const row of rows)sheet.addRow(row);
 return Buffer.from(await book.xlsx.writeBuffer());
}
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
 assert.throws(()=>matchRunningImport([{...row,岗位:'接待岗'},{...row,岗位:'接待岗'}],regs,events),/重复指向同一条报名记录/);
});
test('existing XLSX export can be read as values and CSV preserves leading-zero student IDs',async()=>{
 const bytes=await hoursWorkbook({rows:[{姓名:'合成甲',学号:'00123456',服务时长:2,培训时长:0,交通时长:0}]});
 const rows=await parseRunningFile({name:'合成.xlsx',bytes:bytes.toString('base64')});assert.equal(rows[0]['学号'],'00123456');assert.equal(rows[0]['服务时长'],'2');
 const csvRows=await parseRunningFile({name:'合成.csv',bytes:Buffer.from(csv.replace('20300001','00123456')).toString('base64')});assert.equal(csvRows[0]['学号'],'00123456');
});
test('failure messages tell unknown identity, ambiguous matches and duplicate rows apart',()=>{
 const regs=[{_id:'1',活动ID:'a',姓名:'合成甲',学号:'20300001',报名日期:'2026-10-26',报名时段:'上午',岗位:'接待岗'},{_id:'2',活动ID:'b',姓名:'合成甲',学号:'20300001',报名日期:'2026-10-27',报名时段:'上午',岗位:'接待岗'}];
 const events=[{活动ID:'a',岗位:'接待岗'},{活动ID:'b',岗位:'接待岗'}];
 const row={姓名:'合成甲',学号:'20300001',服务时长:'2',培训时长:'0',交通时长:'0'};
 // 查无此人：必须点名学号，不能只说「无法唯一匹配」。
 assert.throws(()=>matchRunningImport([{...row,学号:'20399999'}],regs,events),error=>{
  assert.match(error.message,/第1条（合成甲 20399999）/);
  assert.match(error.message,/找不到对应的报名记录/);
  assert.doesNotMatch(error.message,/唯一匹配/);
  return true;
 });
 // 命中多条：必须列出候选的日期，让用户知道该补哪一列。
 assert.throws(()=>matchRunningImport([row],regs,events),error=>{
  assert.match(error.message,/无法唯一匹配/);
  assert.match(error.message,/命中 2 条/);
  assert.match(error.message,/2026-10-26/);
  assert.match(error.message,/2026-10-27/);
  return true;
 });
 // 同一报名行被写了两遍：与「命中多条」区分开。
 assert.throws(()=>matchRunningImport([{...row,日期:'2026-10-26'},{...row,日期:'2026-10-26'}],regs,events),/重复指向同一条报名记录/);
});
test('date column accepts the formats people actually type',async()=>{
 const header=['姓名','学号','服务时长','培训时长','交通时长','日期'];
 const cases=[['2026/10/26','2026-10-26'],['2026.10.26','2026-10-26'],['2026年10月26日','2026-10-26'],['2026-10-26 08:00','2026-10-26'],[new Date('2026-10-26T00:00:00Z'),'2026-10-26']];
 for(const [input,expected]of cases){
  const rows=await upload(await sheetBytes(header,[['合成甲','20300001',2,0,0,input]]));
  assert.equal(rows[0]['日期'],expected,`${String(input)} 应归一为 ${expected}`);
 }
 // Excel 日期序列号（文本粘贴时常见）。
 const serial=Math.round((Date.UTC(2026,9,26)-Date.UTC(1899,11,30))/86400000);
 assert.equal((await upload(await sheetBytes(header,[['合成甲','20300001',2,0,0,serial]])))[0]['日期'],'2026-10-26');
 // 不存在的日期不顺延，原样保留交给匹配阶段报错。
 assert.equal((await upload(await sheetBytes(header,[['合成甲','20300001',2,0,0,'2026-02-31']])))[0]['日期'],'2026-02-31');
});
test('generated roster template round-trips: repeated person matches without hand-adding a date',async()=>{
 const roster=[
  {姓名:'合成甲',学号:'20300001',岗位:'接待岗',日期:'2026-10-26',时段:'上午',报名ID:'rec1',服务时长:4,培训时长:0,交通时长:0},
  {姓名:'合成甲',学号:'20300001',岗位:'接待岗',日期:'2026-10-27',时段:'上午',报名ID:'rec2',服务时长:4,培训时长:1,交通时长:0},
  {姓名:'合成乙',学号:'20300002',岗位:'接待岗',日期:'2026-10-26',时段:'上午',报名ID:'rec3',服务时长:3,培训时长:0,交通时长:2},
 ];
 const buffer=await runningTemplateWorkbook(roster);
 const parsed=await upload(buffer);
 assert.deepEqual(Object.keys(parsed[0]).sort(),[...RUNNING_TEMPLATE_COLUMNS].sort());
 assert.equal(parsed.length,3);
 const regs=[
  {_id:'rec1',活动ID:'a',姓名:'合成甲',学号:'20300001',报名日期:'2026-10-26',报名时段:'上午'},
  {_id:'rec2',活动ID:'b',姓名:'合成甲',学号:'20300001',报名日期:'2026-10-27',报名时段:'上午'},
  {_id:'rec3',活动ID:'a',姓名:'合成乙',学号:'20300002',报名日期:'2026-10-26',报名时段:'上午'},
 ];
 const events=[{活动ID:'a',岗位:'接待岗'},{活动ID:'b',岗位:'接待岗'}];
 const matched=matchRunningImport(parsed,regs,events);
 assert.deepEqual(matched.map(item=>item.id).sort(),['rec1','rec2','rec3']);
 assert.equal(Number(matched.find(item=>item.id==='rec2').trainingHours),1);
 // 对照组：把模板的「日期／时段／报名ID」去掉，同一个人立刻无法唯一匹配——这就是本次要消灭的坑。
 const stripped=parsed.map(({姓名,学号,服务时长,培训时长,交通时长})=>({姓名,学号,服务时长,培训时长,交通时长}));
 assert.throws(()=>matchRunningImport(stripped,regs,events),/无法唯一匹配/);
});
test('template holder rejects an empty roster and scales to a blood-week sized project',async()=>{
 await assert.rejects(runningTemplateWorkbook([]),{statusCode:409});
 const roster=[];
 for(let day=0;day<16;day++)for(let person=0;person<24;person++)roster.push({
  姓名:`合成${person}`,学号:`2030${String(person).padStart(4,'0')}`,岗位:'引导岗',
  日期:new Date(Date.UTC(2026,9,26+day)).toISOString().slice(0,10),时段:'上午',报名ID:`r${day}-${person}`,
  服务时长:4,培训时长:0,交通时长:0,
 });
 const parsed=await upload(await runningTemplateWorkbook(roster));
 assert.equal(parsed.length,384);
});
