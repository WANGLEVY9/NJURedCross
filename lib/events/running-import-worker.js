import {parentPort,workerData} from 'node:worker_threads';
import {Readable} from 'node:stream';
import ExcelJS from 'exceljs';
try{
 const workbook=new ExcelJS.Workbook(),bytes=Buffer.from(workerData.bytes,'base64');
 if(workerData.csv)await workbook.csv.read(Readable.from([bytes]),{map:value=>value});else await workbook.xlsx.load(bytes);
 if(workbook.worksheets.length!==1)throw Error('请上传仅包含一张时长表的文件');
 const sheet=workbook.worksheets[0];if(sheet.rowCount>220||sheet.columnCount>25)throw Error('时长表最多200人、25列');
 const aliases={'服务时长（小时）':'服务时长','培训时长（小时）':'培训时长','交通时长（小时）':'交通时长','岗位名称':'岗位','报名行ID':'报名ID','活动日期':'日期'};
 let header,first;
 for(let index=1;index<=Math.min(15,sheet.rowCount);index++){
  const values=sheet.getRow(index).values.slice(1).map(value=>typeof value==='string'?value.trim().replace(/^\uFEFF/,''):value);
  if(['姓名','学号','服务时长'].every(key=>values.map(value=>aliases[value]||value).includes(key))){header=values.map(value=>aliases[value]||value);first=index;break;}
 }
 if(!header||!['培训时长','交通时长'].every(key=>header.includes(key)))throw Error('表头需包含姓名、学号、服务时长、培训时长、交通时长');
 const allowed=['姓名','学号','服务时长','培训时长','交通时长','岗位','日期','时段','报名ID'];
 if(allowed.some(key=>header.filter(value=>value===key).length>1))throw Error('表头有重复字段');
 const rows=[];
 for(let index=first+1;index<=sheet.rowCount;index++){
  const row=sheet.getRow(index),result={};
  for(const key of allowed){const column=header.indexOf(key);if(column<0)continue;let value=row.getCell(column+1).value;
   if(key==='日期'&&value instanceof Date&&!Number.isNaN(value.valueOf()))value=value.toISOString().slice(0,10);
   if(value!==null&&!['string','number'].includes(typeof value))throw Error(`第${index}行含公式或非文本值，请先粘贴为值`);
   result[key]=String(value??'').trim();
  }
  if(Object.values(result).every(value=>value===''))continue;
  if(Object.values(result).some(value=>value.length>500))throw Error(`第${index}行内容过长`);
  rows.push(result);
 }
 if(!rows.length||rows.length>200)throw Error('时长表需包含1至200条记录');
 parentPort.postMessage({rows});
}catch(error){parentPort.postMessage({error:error.message||'时长表读取失败'});}
