import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {hoursWorkbook} from '../lib/events/hours-workbook.js';
import {finalHoursWorkbook} from '../lib/events/final-hours-workbook.js';
import {HOURS_EXPORT_COLUMNS} from '../lib/events/hours-export.js';
for(const kind of ['ordinary','blood'])test(kind+' exports the ten-column import header with one-decimal numeric hours',async()=>{
 const values=['合成同学','合成院系','001234567890123456','合成点位','2026-11-09 09:00–12:00',1.26,0,2.55,'合成服务','保留备注'];
 const row=Object.fromEntries(HOURS_EXPORT_COLUMNS.map((key,i)=>[key,values[i]])),before=structuredClone(row);
 const buffer=kind==='blood'?await hoursWorkbook({rows:[row]}):await finalHoursWorkbook([Object.fromEntries(['name','department','studentId','location','dates','trainingHours','travelHours','serviceHours','work','remark'].map((key,i)=>[key,values[i]]))]);
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);const sheet=book.worksheets[0];
 assert.equal(sheet.rowCount,2);assert.equal(sheet.columnCount,10);assert.deepEqual(sheet.model.merges,[]);assert.deepEqual(sheet.getRow(1).values.slice(1),HOURS_EXPORT_COLUMNS);
 assert.equal(sheet.getCell('C2').value,values[2]);assert.equal(sheet.getCell('C2').numFmt,'@');
 for(const [cell,value]of [['F2',1.3],['G2',0],['H2',2.6]]){assert.equal(sheet.getCell(cell).value,value);assert.equal(sheet.getCell(cell).type,ExcelJS.ValueType.Number);assert.equal(sheet.getCell(cell).numFmt,'0.0');}
 assert.equal(sheet.views[0].ySplit,1);assert.deepEqual(row,before);
});
