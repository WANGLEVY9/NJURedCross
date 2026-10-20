import ExcelJS from 'exceljs';
import {FINAL_HOURS_COLUMNS,FINAL_HOURS_INSTRUCTIONS} from '../../public/app/shared/activity-final-hours.js';
/** Reference layout only: no personal data or source workbook is bundled. */
export async function finalHoursWorkbook(rows){
 if(!rows.length)throw Object.assign(new Error('没有可导出的有效时长'),{statusCode:409});
 const book=new ExcelJS.Workbook();book.creator='南京大学红十字会';book.created=new Date('2026-01-01T00:00:00Z');book.modified=book.created;
 const sheet=book.addWorksheet('分工时长表',{views:[{state:'frozen',ySplit:3}]});
 [9,14,13.735,12.336,18.469,74.938,21.204,21.735,19.336,30.735,13.071].forEach((width,index)=>{sheet.getColumn(index+1).width=width;});
 sheet.mergeCells('A1:K1');sheet.getCell('A1').value='分工时长表';sheet.getRow(1).height=21;
 sheet.addRow(FINAL_HOURS_COLUMNS.map(([,label])=>label));sheet.getRow(2).height=31.5;
 sheet.addRow([...FINAL_HOURS_INSTRUCTIONS]);sheet.getRow(3).height=111.75;
 for(const [index,row]of rows.entries())sheet.addRow(FINAL_HOURS_COLUMNS.map(([key])=>key==='index'?String(index+1):row[key]??''));
 sheet.eachRow((row,index)=>{
  row.eachCell({includeEmpty:true},cell=>{cell.font={name:index<=2?'楷体':'宋体',size:index===1?16:index===2?12:11,bold:index<=2};cell.alignment={vertical:'middle',horizontal:index<=2?'center':'left',wrapText:true};cell.border=Object.fromEntries(['top','bottom','left','right'].map(side=>[side,{style:'thin',color:{argb:'FF000000'}}]));});
  if(index>3){row.height=Math.max(36,Math.min(200,Math.max(...row.values.slice(1).map(value=>String(value??'').split('\n').length))*16));for(const column of [7,8,9])row.getCell(column).numFmt='0.##';row.getCell(4).numFmt='@';}
 });
 sheet.pageSetup={orientation:'portrait',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:3'};
 return Buffer.from(await book.xlsx.writeBuffer());
}
