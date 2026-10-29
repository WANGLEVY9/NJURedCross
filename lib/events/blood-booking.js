/** Reserve an existing generated position. Never append roster rows or copy hours. */
import { bloodSourceOccupied, sourceText } from './blood-source.js';
import { readPagedRows } from '../http/paged-rows.js';
const failure=message=>Object.assign(new Error(message),{statusCode:409});
export const BLOOD_BOOKING_COLUMNS=['网站报名ID','网站账号ID'];
export function missingBloodBookingColumns(metadata,table){
 const columns=metadata?.tables?.find(item=>item.name===table)?.columns||[];
 return BLOOD_BOOKING_COLUMNS.filter(name=>!columns.some(column=>column.name===name&&column.type==='text'));
}
export async function assertBloodBookingSchema(base,table){
 if(typeof base.getMetadata!=='function'||missingBloodBookingColumns(await base.getMetadata(),table).length){
  throw Object.assign(new Error('排班底表缺少有效的网站报名ID、网站账号ID文本列，请联系管理员配置后再报名'),{statusCode:503,code:'blood_booking_schema_required'});
 }
}
const quoteValue=value=>String(value??'').replace(/'/g,"''");
/**
 * 只取本次报名真正需要的两类行：已经挂在本报名下的岗位，以及本班次可占用的岗位。
 *
 * 底表是外部维护的大表，整表读取会把一次报名放大成几十次分页往返。定向查询
 * 不可用（无 SQL、被截断、列语义不同）时一律退回整表读，语义与原来完全一致。
 */
async function targetedBookingRows(base,table,event,code){
 const run=async where=>{
  const rows=await base.query(`SELECT * FROM \`${table}\` WHERE ${where} LIMIT 1000`);
  if(!Array.isArray(rows)||rows.length>=1000||rows.readMeta?.truncated)throw new Error('targeted booking rows unavailable');
  return rows;
 };
 const owned=code?await run(`\`网站报名ID\` = '${quoteValue(code)}'`):[];
 const candidates=await run(`\`点位\` = '${quoteValue(event['地点'])}' AND \`活动时间\` = '${quoteValue(event['报名时段'])}' AND \`日期\` LIKE '${quoteValue(String(event['报名日期']||'').slice(0,10))}%'`);
 return {owned,candidates};
}
export async function syncBloodBooking(base,table,event,registration,state='待审核') {
 const code=registration['报名ID'];
 const belongs=row=>String(row['日期']||'').slice(0,10)===event['报名日期']&&row['点位']===event['地点']&&row['活动时间']===event['报名时段'];
 let owned=null,candidates=null;
 if(typeof base.query==='function'){
  try{({owned,candidates}=await targetedBookingRows(base,table,event,code));}catch{owned=null;candidates=null;}
 }
 // 定向查询没有给出候选行时，仍需整表确认：否则列语义差异会被误判为"没有空位"。
 if(!owned||!candidates||!candidates.length){
  const rows = await readPagedRows(base, table, {
        pageSize: 500,
        maxRows: 100000,
        requireComplete: true,
    });
  owned=rows.filter(row=>row['网站报名ID']===code);
  candidates=rows;
 }
 if(owned.length>1)throw failure('报名对应多个岗位，请联系负责人核对');
 let target=owned[0];
 if(target&&(!belongs(target)||target['网站账号ID']!==registration['账号ID']||target['学号']!==registration['学号']))throw failure('岗位关联已改变，请联系负责人核对');
 const release=['可报名'].includes(state);
 if(!target&&release)return;
 if(!target)target=candidates.find(row=>belongs(row)&&!bloodSourceOccupied(row)&&!['停点','已停点'].includes(row['报名结果']));
 if(!target)throw failure('该班次暂无空余岗位，请选择其他班次');
 if(state==='停点'&&target['网站报名ID']===code&&target['报名结果']==='停点')return target._id;
 if(['停点','已停点'].includes(target['报名结果']))throw failure('该岗位已停点，请联系负责人处理');
 // Re-read immediately before writing, so an already visible NJUTable claim is never overwritten.
 const fresh=await base.getRow(table,target._id);
 if(!fresh||!belongs(fresh)||['停点','已停点'].includes(fresh['报名结果']))throw failure('岗位状态已改变，请重新选择');
 if(!fresh||(!release&&fresh['网站报名ID']!==code&&bloodSourceOccupied(fresh)))throw failure('岗位已被其他报名占用，请重新选择');
 if(fresh['网站报名ID']===code&&(fresh['网站账号ID']!==registration['账号ID']||fresh['学号']!==registration['学号']))throw failure('岗位归属已改变，请联系负责人核对');
 if(release&&fresh['网站报名ID']!==code)throw failure('岗位归属已改变，停止释放');
 const patch=release?{网站报名ID:'',网站账号ID:'',报名结果:'可报名',姓名:'',学号:'',邮箱:'',报名人:''}:{网站报名ID:code,网站账号ID:registration['账号ID'],报名结果:state,姓名:registration['姓名'],学号:registration['学号'],邮箱:registration['邮箱'],报名人:registration['姓名']};
 try{await base.updateRow(table,target._id,patch);}catch{/* An uncertain acknowledgement must be reconciled against the business ID. */}
 const after=await base.getRow(table,target._id);
 if(!after||Object.entries(patch).some(([key,value])=>sourceText(after[key])!==value))throw failure('岗位同步尚未确认，请重试本次操作');
 return target._id;
}
