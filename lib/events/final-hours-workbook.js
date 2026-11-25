import {hoursWorkbook} from './hours-workbook.js';
import {HOURS_EXPORT_COLUMNS} from './hours-export.js';
// Export follows the platform import template; the on-screen review keeps its own layout.
const keys=['name','department','studentId','location','dates','trainingHours','travelHours','serviceHours','work','remark'];
const REMARK_INDEX=keys.indexOf('remark');
/** 补录行在备注列留痕：录入方据此区分「报名正常完成」与「负责人事后补加」。 */
const remarkOf=row=>{
 const base=String(row.remark||'').trim();
 if(!row.manual)return base;
 return base?`${base}；补录`:'补录';
};
export async function finalHoursWorkbook(rows){
 if(!rows.length)throw Object.assign(new Error('没有可导出的有效时长'),{statusCode:409});
 return hoursWorkbook({sheetName:'分工时长表',rows:rows.map(row=>{
  const values=keys.map(key=>row[key]??'');
  values[REMARK_INDEX]=remarkOf(row);
  return Object.fromEntries(HOURS_EXPORT_COLUMNS.map((label,index)=>[label,values[index]]));
 })});
}
