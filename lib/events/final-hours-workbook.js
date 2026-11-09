import {hoursWorkbook} from './hours-workbook.js';
import {HOURS_EXPORT_COLUMNS} from './hours-export.js';
// Export follows the platform import template; the on-screen review keeps its own layout.
const keys=['name','department','studentId','location','dates','trainingHours','travelHours','serviceHours','work','remark'];
export async function finalHoursWorkbook(rows){
 if(!rows.length)throw Object.assign(new Error('没有可导出的有效时长'),{statusCode:409});
 return hoursWorkbook({sheetName:'分工时长表',rows:rows.map(row=>Object.fromEntries(HOURS_EXPORT_COLUMNS.map((label,index)=>[label,row[keys[index]]??''])))});
}
