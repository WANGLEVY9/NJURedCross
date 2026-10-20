import {Worker} from 'node:worker_threads';
const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'running_import_invalid'});
export function parseRunningFile(body){
 if(!body||!['string'].includes(typeof body.name)||!(/\.(xlsx|csv)$/i.test(body.name))||typeof body.bytes!=='string'||!body.bytes||body.bytes.length>56000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.bytes))throw fail('请选择40KB以内的 XLSX 或 CSV 时长表');
 const bytes=Buffer.from(body.bytes,'base64');if(bytes.length>40*1024||bytes.toString('base64')!==body.bytes)throw fail('时长表大小或编码无效');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./running-import-worker.js',import.meta.url),{workerData:{bytes:body.bytes,csv:/\.csv$/i.test(body.name)},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16}});
  let done=false;const finish=(error,rows)=>{if(done)return;done=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(rows);};
  const timer=setTimeout(()=>finish(fail('时长表读取超时，请简化文件后重试')),8000);
  worker.once('message',result=>finish(result.error?fail(result.error):null,result.rows));worker.once('error',()=>finish(fail('时长表读取失败，请检查文件格式')));worker.once('exit',()=>{if(!done)finish(fail('时长表读取中断'));});
 });
}

/** Match exact identities, with explicit job/date disambiguation for repeated participation. */
export function matchRunningImport(rows,registrations,events,saved=[]){
 const used=new Set();
 const result=rows.map((row,index)=>{
  const matches=registrations.filter(reg=>reg['学号']===row['学号']&&reg['姓名']===row['姓名']&&(!row['报名ID']||[reg._id,reg['报名ID']].includes(row['报名ID']))&&(!row['岗位']||(events.find(event=>event['活动ID']===reg['活动ID'])?.['岗位']||reg['岗位'])===row['岗位'])&&(!row['日期']||reg['报名日期']===row['日期'])&&(!row['时段']||reg['报名时段']===row['时段']));
  if(matches.length!==1||used.has(matches[0]._id))throw fail(`第${index+1}条记录无法唯一匹配参与名单，请核对姓名、学号、岗位和日期`);
  const reg=matches[0];used.add(reg._id);const old=saved.find(item=>item.id===reg._id);
  const hours={serviceHours:row['服务时长'],trainingHours:row['培训时长'],travelHours:row['交通时长']};
  for(const value of Object.values(hours))if(value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100000)throw fail(`第${index+1}条记录时长无效`);
  const unchanged=old&&Object.keys(hours).every(key=>Number(hours[key])===old[key]);
  return {id:reg._id,...hours,...(old?.attendanceUrl?{attendanceUrl:old.attendanceUrl}:{}),decision:unchanged?old.decision:'',reason:unchanged?old.reason:'',evidenceChecked:unchanged?old.evidenceChecked:false};
 });
 if(used.size!==registrations.length)throw fail('时长表需包含全部岗位的参与人员，请补齐后再上传');
 return result;
}
