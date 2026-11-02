import {assertBloodBookingSchema} from './blood-booking.js';
import {readPagedRows} from '../http/paged-rows.js';
import {bloodSourceOccupied,sourceText} from './blood-source.js';
const fail=message=>Object.assign(new Error(message),{statusCode:409,code:'manual_blood_sync_conflict'});
/** Reconcile a supplemental participant without overwriting another person's reserved seat. */
export async function syncManualBloodBooking(base,table,event,registration,{onSupplemental}={}){
 await assertBloodBookingSchema(base,table);
 const belongs=row=>String(row['日期']||'').slice(0,10)===event['报名日期']&&row['点位']===event['地点']&&row['活动时间']===event['报名时段'];
 const load=()=>readPagedRows(base,table,{pageSize:500,maxRows:100000,requireComplete:true});
 const rows=await load();let code=registration['报名ID'];const owned=rows.filter(row=>row['网站报名ID']===code);
 if(owned.length>1)throw fail('补录人员对应多个底表记录，请先核对');
 const matches=rows.filter(row=>belongs(row)&&sourceText(row['学号'])===registration['学号']);
 if(matches.some(row=>sourceText(row['姓名']||row['报名人'])!==registration['姓名']||row['网站报名ID']&&row['网站报名ID']!==code)||matches.length>1)throw fail('底表中该学号的身份或报名关联冲突，请先核对');
 let target=owned[0]||matches[0]||rows.find(row=>belongs(row)&&!bloodSourceOccupied(row)&&!['停点','已停点'].includes(row['报名结果']));
 const patch={网站报名ID:code,网站账号ID:registration['账号ID'],报名结果:'成功',姓名:registration['姓名'],学号:registration['学号'],邮箱:registration['邮箱']||'',报名人:registration['姓名']};
 if(target){
  const fresh=await base.getRow(table,target._id);
  if(!fresh||!belongs(fresh)||['停点','已停点'].includes(fresh['报名结果'])||fresh['网站报名ID']&&fresh['网站报名ID']!==code||fresh['网站账号ID']&&fresh['网站账号ID']!==registration['账号ID']||bloodSourceOccupied(fresh)&&fresh['网站报名ID']!==code&&(sourceText(fresh['学号'])!==registration['学号']||sourceText(fresh['姓名']||fresh['报名人'])!==registration['姓名']))throw fail('底表岗位已改变，停止补录同步');
  if(fresh['网站报名ID']===code&&(sourceText(fresh['学号'])!==registration['学号']||fresh['网站账号ID']!==registration['账号ID']))throw fail('补录岗位归属冲突');
  if(!registration['邮箱'])patch['邮箱']=sourceText(fresh['邮箱']);
  try{await base.updateRow(table,target._id,patch);}catch{/* Reconcile a lost acknowledgement below. */}
 }else{
  const week=JSON.parse(event['报名页配置']||'{}').blood?.week;
  if(!Number.isInteger(Number(week))||Number(week)<1)throw fail('班次周次无效，不能新增底表人员');
  if(typeof onSupplemental!=='function')throw fail('补录岗位关联尚未就绪');
  await onSupplemental();code=registration['报名ID'];patch['网站报名ID']=code;
  try{await base.appendRow(table,{日期:event['报名日期'],点位:event['地点'],活动时间:event['报名时段'],周次:Number(week),...patch});}catch{/* Locate the business ID before any retry can append again. */}
 }
 const after=(await load()).filter(row=>row['网站报名ID']===code);
 if(after.length!==1||!belongs(after[0])||Object.entries(patch).some(([key,value])=>sourceText(after[0][key])!==value))throw fail('底表同步结果待核对，请保留原窗口重试');
 target=after[0];return target._id;
}
