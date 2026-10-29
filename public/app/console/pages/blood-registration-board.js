import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';

/** A view of the already scoped project snapshot; never fetch a second catalogue. */
export function bloodRegistrationBoard({events,registrations,state,busy=false,canManage=false,onApprove,onReject,onLeave,onBatch}){
 const root=h('section',{class:'blood-registration-board','aria-label':'献血车排班看板'}),grid=h('div',{class:'blood-registration-board__grid'}),count=h('p',{'aria-live':'polite',class:'t-caption'});
 const eligible=row=>canManage&&!busy&&row['报名状态']==='待筛选'&&row['请假状态']!=='待审批'&&events.some(e=>e['活动ID']===row['活动ID']&&e['状态']==='报名中');
 let saving=false;
 const date=field({label:'服务日期',options:[{value:'',label:'全部日期'},...[...new Set(events.map(e=>e['报名日期']).filter(Boolean))].sort().map(value=>({value,label:value}))]}),point=field({label:'服务点位',options:[{value:'',label:'全部点位'},...[...new Set(events.map(e=>e['地点']).filter(Boolean))].map(value=>({value,label:value}))]});
 const selected=state.selected;
 const statusText=text=>h('strong',{class:'blood-board-status '+(['报名成功','已确认','已签到'].includes(text)?'blood-board-status--success':['报名中','报名失败','未入选','停点'].includes(text)?'blood-board-status--red':'blood-board-status--muted'),text});
 const shown=()=>events.filter(e=>(!date.control.value||e['报名日期']===date.control.value)&&(!point.control.value||e['地点']===point.control.value));
 const shownRows=()=>registrations.filter(r=>shown().some(e=>e['活动ID']===r['活动ID']));
 function select(rows,checked){for(const row of rows.filter(eligible))if(checked)selected.add(row._id);else selected.delete(row._id);render();}
 async function decide(decision){
  const rows=shownRows().filter(r=>selected.has(r._id)&&eligible(r));if(!rows.length||saving)return;
  if(rows.length>100){count.textContent='单次最多处理100人，请减少选择';return;}
  if(decision==='confirm'){
   if(!await confirmAction({title:`确认 ${rows.length} 人报名成功？`,description:'确认后沿用现有邮件通知流程。',confirmLabel:'确认成功并通知'}))return;
   saving=true;render();try{await onBatch(rows,decision);}finally{saving=false;render();}return;
  }
  const reason=field({label:'失败原因',multiline:true,required:true,maxlength:500}),vacancy=field({label:'所选名额后续安排',options:[{value:'open',label:'重新开放所选名额'},{value:'closed',label:'不再开放所选名额'}]});let drawer,working=false;
  const submit=button({label:'确认失败并通知',variant:'primary',onClick:async()=>{
   if(working||!reason.control.reportValidity()||!reason.control.value.trim())return;working=true;saving=true;submit.disabled=true;render();
   try{await onBatch(rows,decision,vacancy.control.value==='open',reason.control.value.trim());working=false;await drawer.close();}finally{working=false;saving=false;render();}
  }});
  drawer=openDrawer({title:`处理 ${rows.length} 人报名失败`,body:h('div',{class:'stack-4'},notice('仅影响所选报名对应的名额，不关闭整个班次。'),reason,vacancy),beforeClose:()=>!working,footer:[button({label:'取消',onClick:()=>drawer.close()}),submit]});
 }
 const approve=button({label:'批量报名成功并通知',onClick:()=>decide('confirm')}),reject=button({label:'批量报名失败并通知',onClick:()=>decide('reject')});
 function render(){
  for(const id of [...selected])if(!registrations.some(r=>r._id===id&&eligible(r)))selected.delete(id);
  const n=shownRows().filter(r=>selected.has(r._id)).length;count.textContent=`当前筛选已选 ${n} 人；仅待确认报名可选。`;
  approve.disabled=reject.disabled=busy||saving||!n;grid.replaceChildren();
  const dates=[...new Set(shown().map(e=>e['报名日期']))].sort();
  for(const day of dates){
   const jobs=shown().filter(e=>e['报名日期']===day),dayRows=shownRows().filter(r=>jobs.some(e=>e['活动ID']===r['活动ID']));
   const column=h('section',{class:'blood-registration-board__day'}),week=['周日','周一','周二','周三','周四','周五','周六'][new Date(day+'T12:00:00+08:00').getUTCDay()];
   column.append(h('header',{},h('h3',{text:day+' '+week}),dayRows.some(eligible)?button({label:'选择本日待确认',size:'sm',disabled:saving||busy,onClick:()=>select(dayRows,true)}):null));
   for(const event of jobs.sort((a,b)=>String(a['地点']).localeCompare(String(b['地点']),'zh-CN')||String(a['报名时段']).localeCompare(String(b['报名时段'])))){
    const rows=registrations.filter(r=>r['活动ID']===event['活动ID']);
    const slot=h('section',{class:'blood-registration-board__slot'},h('h4',{text:event['地点']||'未填写点位'}),h('p',{text:event['报名时段']||'未填写时段'}),statusText(event['状态']),rows.some(eligible)?button({label:'全选本班次待审批报名',size:'sm',disabled:saving||busy,onClick:()=>select(rows,true)}):null);
    for(const row of rows){
     const label=row['请假状态']==='待审批'?'请假待审批':row['请假状态']==='已批准'?'请假已批准':row['报名状态']==='待筛选'?'待确认':row['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(row['报名状态'])?'报名成功':row['报名状态'];
     const check=h('input',{type:'checkbox',checked:selected.has(row._id),disabled:saving||!eligible(row),'aria-label':`选择 ${row['姓名']||'报名人'}`,on:{change:ev=>select([row],ev.target.checked)}});
     const card=h('article',{class:'blood-registration-board__card'},h('label',{},check,h('strong',{text:row['姓名']||'报名人'})),statusText(label),h('small',{text:row['学号']||''}));
     const actions=h('div',{class:'row-2 row-wrap'});
     if(eligible(row))actions.append(button({label:'报名成功',size:'sm',disabled:saving,onClick:()=>onApprove(row)}),button({label:'报名失败',size:'sm',disabled:saving,onClick:()=>onReject(row)}));
     if(canManage&&!busy&&row['请假状态']==='待审批')actions.append(button({label:'批准请假',size:'sm',disabled:saving,onClick:()=>onLeave(row,true)}),button({label:'驳回请假',size:'sm',disabled:saving,onClick:()=>onLeave(row,false)}));
     card.append(actions);slot.append(card);
    }
    column.append(slot);
   }
   grid.append(column);
  }
  if(!dates.length)grid.append(h('p',{text:'暂无符合条件的班次'}));
 }
 for(const control of [date.control,point.control])control.addEventListener('change',()=>{selected.clear();render();});
 root.append(h('div',{class:'row-2 row-wrap'},date,point),h('div',{class:'row-2 row-wrap'},button({label:'选择当前筛选待确认',onClick:()=>select(shownRows(),true)}),button({label:'取消选择',onClick:()=>{selected.clear();render();}}),approve,reject),count,grid);render();return root;
}
