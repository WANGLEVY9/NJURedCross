import {parentPort,workerData} from 'node:worker_threads';
import {Readable} from 'node:stream';
import ExcelJS from 'exceljs';
const pad=value=>String(value).padStart(2,'0');
/**
 * 日期列宽容解析：Excel 日期、序列号、2026/10/26、2026.10.26、2026年10月26日、带时间戳
 * 都归一到 YYYY-MM-DD，与报名行的 `报名日期` 对齐；无法归一的原样保留，交给匹配阶段报错。
 */
function normalizedDate(value){
 if(value instanceof Date&&!Number.isNaN(value.valueOf()))return value.toISOString().slice(0,10);
 if(typeof value==='number'&&Number.isFinite(value)&&value>20000&&value<80000)return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 const text=String(value??'').trim();if(!text)return '';
 const matched=text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[ T].*)?$/);
 if(!matched)return text;
 const iso=`${matched[1]}-${pad(matched[2])}-${pad(matched[3])}`,probe=new Date(`${iso}T00:00:00Z`);
 // 2 月 31 日这类不存在的日期会被 Date 顺延，回读不一致就保持原样。
 return Number.isFinite(probe.valueOf())&&probe.toISOString().slice(0,10)===iso?iso:text;
}
try{
 const workbook=new ExcelJS.Workbook(),bytes=Buffer.from(workerData.bytes,'base64');
 if(workerData.csv)await workbook.csv.read(Readable.from([bytes]),{map:value=>value});else await workbook.xlsx.load(bytes);
 if(workbook.worksheets.length!==1)throw Error('请上传仅包含一张时长表的文件');
 // 行数上限须与下面「1 至 900 条记录」一致，多留表头与空白行的余量；
 // 献血周 16 场次约 384 人，旧的 220 行上限会先把正常规模拦成「最多200人」。
 const sheet=workbook.worksheets[0];if(sheet.rowCount>920||sheet.columnCount>25)throw Error('时长表最多900人、25列');
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
  for(const key of allowed){const column=header.indexOf(key);if(column<0)continue;const value=row.getCell(column+1).value;
   if(key==='日期'){result[key]=normalizedDate(value);continue;}
   if(value!==null&&!['string','number'].includes(typeof value))throw Error(`第${index}行含公式或非文本值，请先粘贴为值`);
   result[key]=String(value??'').trim();
  }
  if(Object.values(result).every(value=>value===''))continue;
  if(Object.values(result).some(value=>value.length>500))throw Error(`第${index}行内容过长`);
  rows.push(result);
 }
 // 献血周按周一归周，16 个场次合计三百余条；上限只为拦住异常大表，不再限制正常规模。
 if(!rows.length||rows.length>900)throw Error('时长表需包含1至900条记录');
 parentPort.postMessage({rows});
}catch(error){parentPort.postMessage({error:error.message||'时长表读取失败'});}
