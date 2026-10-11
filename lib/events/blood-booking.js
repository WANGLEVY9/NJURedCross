/** Reserve an existing generated position. Never append roster rows or copy hours. */
import { bloodSourceOccupied, sourceText } from './blood-source.js';
const failure=message=>Object.assign(new Error(message),{statusCode:409});
export const BLOOD_BOOKING_COLUMNS=['网站报名ID','网站账号ID'];
export async function syncBloodBooking(base,table,event,registration,state='待审核') {
 const rows=[];for(let start=0;start<100000;start+=500){const page=await base.listRows(table,'','',false,start,500);rows.push(...page);if(page.length<500)break;}
 const code=registration['报名ID'];
 const belongs=row=>String(row['日期']||'').slice(0,10)===event['报名日期']&&row['点位']===event['地点']&&row['活动时间']===event['报名时段'];
 const owned=rows.filter(row=>row['网站报名ID']===code);
 if(owned.length>1)throw failure('报名对应多个岗位，请联系负责人核对');
 let target=owned[0];
 if(target&&(!belongs(target)||target['网站账号ID']!==registration['账号ID']||target['学号']!==registration['学号']))throw failure('岗位关联已改变，请联系负责人核对');
 const release=['可报名'].includes(state);
 if(!target&&release)return;
 if(!target)target=rows.find(row=>belongs(row)&&!bloodSourceOccupied(row)&&!['停点','已停点'].includes(row['报名结果']));
 if(!target)throw failure('该班次暂无空余岗位，请选择其他班次');
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
