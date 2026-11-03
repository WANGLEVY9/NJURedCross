import {runWorkerTask} from '../worker-task.js';
const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'running_import_invalid'});
export function parseRunningFile(body){
 if(!body||!['string'].includes(typeof body.name)||!(/\.(xlsx|csv)$/i.test(body.name))||typeof body.bytes!=='string'||!body.bytes||body.bytes.length>56000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.bytes))throw fail('请选择40KB以内的 XLSX 或 CSV 时长表');
 const bytes=Buffer.from(body.bytes,'base64');if(bytes.length>40*1024||bytes.toString('base64')!==body.bytes)throw fail('时长表大小或编码无效');
 return runWorkerTask(new URL('./running-import-worker.js',import.meta.url),{workerData:{bytes:body.bytes,csv:/\.csv$/i.test(body.name)},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16}},{timeoutMs:8000,failure:()=>fail('时长表读取失败，请检查文件格式'),timeoutFailure:()=>fail('时长表读取超时，请简化文件后重试')}).then(result=>{if(result.error)throw fail(result.error);return result.rows;});
}

/** 报错必须带上是「查无此人」还是「命中多条」，否则用户只能盲改表格。 */
const who=(index,row)=>`第${index+1}条（${row['姓名']||'姓名为空'} ${row['学号']||'学号为空'}）`;
const describe=matches=>{
 const shown=matches.slice(0,3).map(reg=>[reg['报名日期'],reg['报名时段'],reg['岗位']].filter(Boolean).join(' ')||'未填日期');
 return shown.join('；')+(matches.length>3?`；等 ${matches.length} 条`:'');
};

/** Match exact identities, with explicit job/date disambiguation for repeated participation. */
export function matchRunningImport(rows,registrations,events,saved=[]){
 const used=new Set();
 const result=rows.map((row,index)=>{
  const matches=registrations.filter(reg=>reg['学号']===row['学号']&&reg['姓名']===row['姓名']&&(!row['报名ID']||[reg._id,reg['报名ID']].includes(row['报名ID']))&&(!row['岗位']||(events.find(event=>event['活动ID']===reg['活动ID'])?.['岗位']||reg['岗位'])===row['岗位'])&&(!row['日期']||reg['报名日期']===row['日期'])&&(!row['时段']||reg['报名时段']===row['时段']));
  if(!matches.length)throw fail(`${who(index,row)}在参与名单里找不到对应的报名记录，请核对姓名、学号是否与名单完全一致（注意空格和全角字符）`);
  if(matches.length>1)throw fail(`${who(index,row)}无法唯一匹配参与名单：命中 ${matches.length} 条（${describe(matches)}），请补充「日期」或「时段」列区分，或直接下载名单模板重填`);
  if(used.has(matches[0]._id))throw fail(`${who(index,row)}与前面的行重复指向同一条报名记录（${describe(matches)}），请删除重复行`);
  const reg=matches[0];used.add(reg._id);const old=saved.find(item=>item.id===reg._id);
  const hours={serviceHours:row['服务时长'],trainingHours:row['培训时长'],travelHours:row['交通时长']};
  for(const value of Object.values(hours))if(value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100000)throw fail(`${who(index,row)}的服务／培训／交通时长无效，请填写 0 或正数（可带小数）`);
  const unchanged=old&&Object.keys(hours).every(key=>Number(hours[key])===old[key]);
  return {id:reg._id,...hours,...(old?.attendanceUrl?{attendanceUrl:old.attendanceUrl}:{}),decision:unchanged?old.decision:'',reason:unchanged?old.reason:'',evidenceChecked:unchanged?old.evidenceChecked:false};
 });
 if(used.size!==registrations.length)throw fail('时长表需包含全部岗位的参与人员，请补齐后再上传');
 return result;
}
