import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,notice,definitionList} from '../../ui/primitives.js';
import {openDrawer} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';

/** Source adapters project rows on read; never import duplicate workflow events. */
export async function openScheduleSource(onRefresh=async()=>{}){
 try{
  const {result}=await request('/api/volunteer/workflow/blood-schedule-source',{fresh:true});
  const body=h('div',{class:'stack-4'},
   notice('献血车属于自动排班活动：模板表 → 底表自动化生成岗位 → 平台读取。无需用“新建活动”或“来源活动纳入”重复导入。'),
   definitionList([['岗位来源底表',result.sourceTable],['模板表',result.templateTable],['已读取班次',String(result.sessionCount)],['底表有效名额合计',String(result.capacity)]]),
   !result.bookingReady?notice(`报名占位尚未就绪：请管理员核对底表文本列 ${result.missingBookingColumns.join('、')}。本入口不会自动增列或修改历史数据。`,{tone:'warning'}):notice('报名占位关联列已就绪。'),
   notice('新增日期、班次、名额或停点在底表维护，刷新后读取。已有报名、签到和时长不迁移；照片证据和时长审核规则保留。'),
   result.templateAvailable?h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},...['序号','点位','活动时间'].map(text=>h('th',{text})))),h('tbody',{},...result.templateRows.map(row=>h('tr',{},...['序号','点位','活动时间'].map(key=>h('td',{text:row[key]||'—'}))))))):notice('未找到模板表；平台仍可读取已生成的底表岗位。请由底表管理员核对模板及自动化规则。',{tone:'warning'}));
  let drawer,busy=false;
  const refresh=button({label:'刷新排班',onClick:async()=>{if(busy)return;busy=true;refresh.disabled=true;try{await onRefresh();await drawer.close();}catch(error){reportError(error,'排班刷新失败');}finally{busy=false;refresh.disabled=false;}}});
  drawer=openDrawer({title:'排班来源与模板',width:850,body,footer:[button({label:'关闭',onClick:()=>drawer.close()}),refresh]});
 }catch(error){reportError(error,'排班来源与模板读取失败');}
}
