import {BLOOD_POINTS} from '../../shared/blood-points.js';
import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';

/** A view of the already scoped project snapshot; never fetch a second catalogue. */
export function bloodRegistrationBoard({events,registrations,state,busy=false,canManage=false,onApprove,onReject,onLeave,onBatch,onBatchLeave,onToggleSession,onRenotify,weekPicker}){
 const root=h('section',{class:'blood-registration-board','aria-label':'献血车排班看板'}),grid=h('div',{class:'blood-registration-board__grid'}),count=h('p',{'aria-live':'polite',class:'t-caption'});
 const canApprove=row=>canManage&&!busy&&row['报名状态']==='待筛选'&&row['请假状态']!=='待审批'&&events.some(e=>e['活动ID']===row['活动ID']&&e['状态']==='报名中');
 const eligible=row=>state.selectionMode==='notice'?canManage&&!busy&&['已确认','已签到','未入选'].includes(row['报名状态'])&&row['请假状态']!=='待审批':state.selectionMode==='leave'?canManage&&!busy&&row['请假状态']==='待审批'&&['待筛选','已确认'].includes(row['报名状态']):canApprove(row);
 let saving=false;
 const date=field({label:'服务日期',options:[{value:'',label:'全部日期'},...[...new Set(events.map(e=>e['报名日期']).filter(Boolean))].sort().map(value=>({value,label:value}))]}),point=field({label:'服务点位',options:[{value:'',label:'全部点位'},...[...new Set(events.map(e=>e['地点']).filter(Boolean))].map(value=>({value,label:value}))]});
 const monday=value=>{const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
 const weeks=[...new Set(events.map(e=>e['报名日期']).filter(Boolean).map(monday))].sort();
 const week=field({label:'排班周',options:weeks.map(value=>({value,label:value+' 起的一周'}))});
 const selected=state.selected;
 const statusText=text=>h('strong',{class:'blood-board-status '+(['报名成功','已确认','已签到'].includes(text)?'blood-board-status--success':['报名中','报名失败','未入选','停点'].includes(text)?'blood-board-status--red':'blood-board-status--muted'),text});
 const shown=()=>events.filter(e=>(!week.control.value||monday(e['报名日期'])===week.control.value)&&(!date.control.value||e['报名日期']===date.control.value)&&(!point.control.value||e['地点']===point.control.value));
 const shownRows=()=>registrations.filter(r=>shown().some(e=>e['活动ID']===r['活动ID']));
 function select(rows,checked){for(const row of rows.filter(eligible))if(checked)selected.add(row._id);else selected.delete(row._id);render();}
 async function decide(decision){
  const rows=shownRows().filter(r=>selected.has(r._id)&&eligible(r));if(!rows.length||saving)return;
  if(rows.length>100){count.textContent='单次最多处理100人，请减少选择';return;}
  if(decision==='confirm'){
   if(!await confirmAction({title:`确认 ${rows.length} 人报名成功？`,description:'确认后沿用现有邮件通知流程。',confirmLabel:'确认成功并通知'}))return;
   saving=true;render();try{await onBatch(rows,decision);}finally{saving=false;render();}return;
  }
  const reason=field({label:'失败原因',multiline:true,required:true,maxlength:500}),vacancy=field({label:'所选名额后续安排',options:[{value:'open',label:'释放名额，允许其他同学报名'},{value:'closed',label:'关闭该名额，不再接受报名'}]});let drawer,working=false;
  const submit=button({label:'确认失败并通知',variant:'primary',onClick:async()=>{
   if(working||!reason.control.reportValidity()||!reason.control.value.trim())return;working=true;saving=true;submit.disabled=true;render();
   try{await onBatch(rows,decision,vacancy.control.value==='open',reason.control.value.trim());working=false;await drawer.close();}finally{working=false;saving=false;render();}
  }});
  drawer=openDrawer({title:`处理 ${rows.length} 人报名失败`,body:h('div',{class:'stack-4'},notice('仅影响所选报名对应的名额，不关闭整个班次。'),reason,vacancy),beforeClose:()=>!working,footer:[button({label:'取消',onClick:()=>drawer.close()}),submit]});
 }
 const approve=button({label:'批量报名成功并通知',onClick:()=>decide('confirm')}),reject=button({label:'批量报名失败并通知',onClick:()=>decide('reject')});
 const rowOptions=[1,0,3,2].flatMap(index=>['上午','下午'].map(period=>({value:index+'|'+period,label:BLOOD_POINTS[index]+' '+period})));
 const rowChoice=field({label:'横向选择岗位',options:rowOptions});
 const selectRow=button({label:'全选该岗位本周待处理记录',onClick:()=>{const [index,period]=rowChoice.control.value.split('|');const ids=new Set(shown().filter(e=>e['地点']===BLOOD_POINTS[Number(index)]&&String(e['报名时段']).startsWith(period)).map(e=>e['活动ID']));select(shownRows().filter(r=>ids.has(r['活动ID'])),true);}});
 const begin=mode=>{state.selectionMode=mode;state.batchEditing=true;selected.clear();render();};
 const entry=h('div',{class:'blood-batch-entry row-2 row-wrap'},button({label:'批量审批报名',onClick:()=>begin('approval')}),button({label:'批量处理请假',onClick:()=>begin('leave')}),button({label:'再次通知',onClick:()=>begin('notice')}));
 const exit=button({label:'退出批量操作',onClick:()=>{state.batchEditing=false;selected.clear();render();}});
 const range=h('details',{class:'blood-selection-range'},h('summary',{text:'按岗位选择'}),rowChoice,selectRow);
 const tools=h('div',{class:'blood-batch-toolbar row-2 row-wrap'});
 const renotify=button({label:'确认再次通知',onClick:()=>onRenotify?.(shownRows().filter(row=>selected.has(row._id)&&eligible(row)))});
 const approveLeave=button({label:'批量批准请假',onClick:()=>onBatchLeave?.(true)}),rejectLeave=button({label:'批量驳回请假',onClick:()=>onBatchLeave?.(false)});
 function render(){
  entry.hidden=!!state.batchEditing;tools.hidden=!state.batchEditing;count.hidden=!state.batchEditing;
  for(const id of [...selected])if(!registrations.some(r=>r._id===id&&eligible(r)))selected.delete(id);
  const n=shownRows().filter(r=>selected.has(r._id)).length;count.textContent=`当前筛选已选 ${n} 人；${state.selectionMode==='notice'?'仅已有报名结果可选':state.selectionMode==='leave'?'仅待审批请假可选':'仅待审批报名可选'}。`;
  approve.hidden=reject.hidden=['leave','notice'].includes(state.selectionMode);renotify.hidden=state.selectionMode!=='notice';renotify.disabled=busy||saving||!n;approveLeave.hidden=rejectLeave.hidden=state.selectionMode!=='leave';approve.disabled=reject.disabled=approveLeave.disabled=rejectLeave.disabled=busy||saving||!n;grid.replaceChildren();
  const dates=[...new Set(shown().map(e=>e['报名日期']))].sort();
  if(!dates.length){grid.append(h('p',{text:'暂无排班'}));return;}
  const first=new Date(dates[0]+'T00:00:00Z'),offset=(first.getUTCDay()+6)%7;first.setUTCDate(first.getUTCDate()-offset);
  const days=Array.from({length:7},(_,i)=>{const d=new Date(first);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
  const board=h('div',{class:'blood-card-grid','aria-label':'每周卡片排班'});
  days.forEach((day,i)=>board.append(h('header',{class:'blood-card-grid__heading'},h('strong',{text:['周一','周二','周三','周四','周五','周六','周日'][i]}),h('small',{text:day}))));
  const points=[BLOOD_POINTS[1],BLOOD_POINTS[0],BLOOD_POINTS[3],BLOOD_POINTS[2]],names=['印象汇','中央','弘阳广场','学则路'];
  const labelOf=row=>row['请假状态']==='待审批'?'请假待审批':row['请假状态']==='已批准'?'请假已批准':row['报名状态']==='待筛选'?'待审批':row['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(row['报名状态'])?'报名成功':row['报名状态'];
  function details(event,rows,day,location){
   const body=h('div',{class:'stack-4'},h('p',{text:day+' '+location+' '+(event?.['报名时段']||'未排班')}));
   for(const row of rows){const actions=h('div',{class:'row-2 row-wrap'});
    if(canApprove(row))actions.append(button({label:'报名成功',onClick:()=>onApprove(row)}),button({label:'报名失败',onClick:()=>onReject(row)}));
    if(canManage&&!busy&&row['请假状态']==='待审批')actions.append(button({label:'批准请假',onClick:()=>onLeave(row,true)}),button({label:'驳回请假',onClick:()=>onLeave(row,false)}));
    body.append(h('section',{class:'stack-3'},statusText(labelOf(row)),h('p',{text:[row['姓名'],row['学号']].filter(Boolean).join(' ')}),h('p',{text:row['报名状态']==='已签到'?'已签到':row['签到照片ID']?'已提交签到资料':'未提交签到资料'}),row['请假原因']?h('p',{text:'请假原因：'+row['请假原因']}):null,actions));
   }
   if(event&&onToggleSession&&canManage&&['报名中','进行中'].includes(event['状态'])){let c;try{c=JSON.parse(event['报名页配置']||'{}');}catch{c={};}const enabled=c.sourceRegistration?.enabled!==false;body.append(button({label:enabled?'结束本场报名':'重新开放本场报名',onClick:ev=>onToggleSession(event,!enabled,ev.currentTarget)}));}
   if(!rows.length)body.append(h('p',{text:event?'暂无报名人员':'该日期未安排此岗位'}));
   openDrawer({title:'班次详情',body});
  }
  for(const [index,location] of points.entries())for(const period of ['上午','下午'])for(const day of days){
   const event=shown().find(e=>e['地点']===location&&e['报名日期']===day&&String(e['报名时段']||'').startsWith(period));
   const rows=event?registrations.filter(r=>r['活动ID']===event['活动ID']):[];
   const live=rows.filter(r=>!['未入选','已取消','已请假'].includes(r['报名状态']));
   const displayRows=(live.length?live:rows).slice(0,2);
   const label=!event?'未排班':['已结束','停点','已归档'].includes(event['状态'])?event['状态']:live.some(r=>r['请假状态']==='待审批')?'请假待审批':live.some(r=>r['报名状态']==='待筛选')?'待审批':live.length?'报名成功':event['状态'];
   const tone=['报名成功','已签到'].includes(label)?'success':['待审批','请假待审批'].includes(label)?'review':label==='报名中'?'open':label==='进行中'?'running':['报名失败','停点'].includes(label)?'failed':label.startsWith('请假')?'leave':'ended';
   const card=h('article',{class:'blood-schedule-card'+(!event?' is-unplanned':''),tabindex:0,role:'button','aria-label':day+' '+names[index]+' '+period+' '+label,on:{click:()=>details(event,rows,day,location),keydown:ev=>{if(ev.target===card&&['Enter',' '].includes(ev.key)){ev.preventDefault();details(event,rows,day,location);}}}},
    h('div',{class:'blood-schedule-card__title'},h('span',{class:'blood-schedule-status blood-schedule-status--'+tone,text:label}),h('strong',{text:names[index]})),
    h('p',{class:'blood-schedule-card__time',text:event?.['报名时段']||period+' · 未排班'}));
   const people=h('div',{class:'blood-schedule-card__people'});
   for(const row of displayRows){const check=state.batchEditing&&eligible(row)?h('input',{type:'checkbox',checked:selected.has(row._id),disabled:saving,'aria-label':'选择 '+row['姓名'],on:{click:ev=>ev.stopPropagation(),keydown:ev=>ev.stopPropagation(),change:ev=>select([row],ev.target.checked)}}):null;people.append(h('div',{},check,h('span',{text:[row['姓名'],row['学号']].filter(Boolean).join(' ')})));}
   if(!displayRows.length)people.append(h('span',{class:'t-muted',text:event?'暂无报名':'—'}));
   if(rows.length>2)people.append(h('small',{text:`共 ${rows.length} 条记录，点击查看全部`}));
   card.append(people);board.append(card);
  }
  grid.append(board);
 }
 for(const control of [date.control,point.control,week.control])control.addEventListener('change',()=>{selected.clear();render();});
 tools.append(exit,count,range,button({label:'全选当前待处理记录',onClick:()=>select(shownRows(),true)}),button({label:'清空选择',onClick:()=>{selected.clear();render();}}),approve,reject,approveLeave,rejectLeave,renotify);
 root.append(...(weeks.length>1?[week]:[]),entry,tools,weekPicker?.(),grid);render();return root;
}
