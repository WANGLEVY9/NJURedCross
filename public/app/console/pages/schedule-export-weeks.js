import {request} from '../../core/api.js';
import {h} from '../../core/dom.js';
import {button} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';

export async function selectExportWeeks(event){
 const data=await request(`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/schedule-total`,{fresh:true});
 const weeks=data.weeks||[];
 if(!weeks.length)throw Error('暂无可导出的排班周次');
 const current=JSON.parse(event['报名页配置']||'{}').special?.week;
 return new Promise(resolve=>{
  let modal;const selected=new Set(weeks.includes(current)?[current]:[weeks.at(-1)]);
  const save=button({label:'下载所选周次',variant:'primary',onClick:()=>{if(selected.size){resolve([...selected].sort());void modal.close();}}});
  const list=h('div',{class:'stack-3'},...weeks.map(week=>h('label',{class:'row-2'},h('input',{type:'checkbox',checked:selected.has(week),on:{change:e=>{if(e.target.checked)selected.add(week);else selected.delete(week);save.disabled=!selected.size;}}}),h('span',{text:`${week} 起的一周`}))));
  modal=openModal({title:'选择导出周次',body:list,footer:[button({label:'取消',onClick:()=>modal.close()}),save],onClose:()=>resolve(null)});
 });
}
