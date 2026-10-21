import {rosterColumns} from '../roster-columns.js';
import {h} from '../../core/dom.js';
import {button,badge,field,panel,emptyState,notice,definitionList} from '../../ui/primitives.js';
import {openDrawer} from '../../ui/overlay.js';
import {registrationParticipant} from '../../shared/registration-profile.js';
import {createPositionLabels} from '../../shared/position-labels.js';

const canApprove=row=>row['报名状态']==='待筛选'&&row['请假状态']!=='待审批';
const result=row=>row['报名状态']==='待筛选'?'待审批':row['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(row['报名状态'])?'报名成功':row['报名状态']||'未提供';
const compare=(a,b)=>String(a||'').localeCompare(String(b||''),'zh-CN',{numeric:true});
const config=event=>{try{return JSON.parse(event?.['报名页配置']||'{}');}catch{return {};}};

export function legacyRosterPanel({event,events=[],registrations=[],directory=[],directoryError=false,state,busy=false,onBatch,onBatchLeave,onApprove,onReason,onDetails,context,matches,compact=false,showLegend=true}){
 for(const [key,value] of Object.entries({search:'',date:'',position:'',session:'',status:'',campus:'',leave:'',order:'asc',selectionMode:'approval'}))if(state[key]===undefined)state[key]=value;
 if(compact){for(const key of ['position','session','campus','leave'])state[key]='';state.order='asc';}
 const pendingLeave=row=>row['请假状态']==='待审批'&&['待筛选','已确认'].includes(row['报名状态']);
 const selectable=row=>state.selectionMode==='leave'?pendingLeave(row):canApprove(row);
 if(!(state.selected instanceof Set))state.selected=new Set();
 const profiles=Array.isArray(directory)?directory:directory.participants||[];
 const columns=rosterColumns({columns:['序号','选择','姓名','学号','部门','日期 / 班次','报名 / 请假','操作'],key:'registration-'+event._id});
 const positions=createPositionLabels({event,events,registrations});
 const rowContext=row=>{
  const value=context(row),source=events.find(item=>item['活动ID']===value.session)||event,settings=config(source);
  return {...value,campus:value.campus||settings.ordinary?.campus||settings.blood?.campus||source?.['校区']||''};
 };
 const contexts=registrations.map(rowContext);
 const records=h('div',{class:'activity-records activity-legacy-roster__records'});
 const count=h('span',{role:'status','aria-live':'polite'});
 const visibleRows=()=>registrations.filter(row=>matches(row,state));
 const select=button({label:'全选当前可处理报名',size:'sm',onClick:()=>{state.selectionMode='approval';state.selected.clear();for(const row of visibleRows().filter(canApprove))state.selected.add(row._id);renderRows();}});
 const selectLeave=button({label:'全选当前请假申请',size:'sm',onClick:()=>{state.selectionMode='leave';state.selected.clear();for(const row of visibleRows().filter(pendingLeave))state.selected.add(row._id);renderRows();}});
 const deselect=button({label:'取消选择',size:'sm',variant:'ghost',onClick:()=>{state.selected.clear();renderRows();}});
 const approve=button({label:'批量批准并通知',variant:'primary',size:'sm',onClick:()=>onBatch?.()});
 const approveLeave=button({label:'批量批准请假',size:'sm',onClick:()=>onBatchLeave?.(true)});
 const rejectLeave=button({label:'批量驳回请假',size:'sm',onClick:()=>onBatchLeave?.(false)});
 const values=key=>[...new Set(contexts.map(value=>value[key]).filter(Boolean))].sort(compare).map(value=>({value,label:value}));
 const controls=[];
 const makeFilter=(key,label,options)=>{
  const control=field({label,value:state[key],options:[{value:'',label:`全部${label}`},...options],onInput:input=>{state[key]=input.target.value;renderRows();}});
  controls.push(control);return control;
 };
 const search=field({label:'查找志愿者',type:'search',value:state.search,placeholder:'姓名或学号',onInput:input=>{state.search=input.target.value;renderRows();}});
 const date=makeFilter('date','报名日期',values('date'));
 const position=makeFilter('position','报名岗位',values('position'));
 const session=makeFilter('session','报名班次',[...new Map(contexts.map(value=>[value.session,{value:value.session,label:`${value.date} ${value.slot} ${value.location} ${value.position}`}])).values()]);
 const status=makeFilter('status','报名状态',[...new Set(registrations.map(row=>row['报名状态']).filter(Boolean))].map(value=>({value,label:value==='待筛选'?'待审批':value})).concat({value:'leave',label:'请假待审批'}));
 const campus=makeFilter('campus','活动校区',values('campus'));
 const leave=makeFilter('leave','请假状态',[{value:'none',label:'未请假'},...[...new Set(registrations.map(row=>row['请假状态']).filter(Boolean))].map(value=>({value,label:value}))]);
 const order=field({label:'名单排序',value:state.order,options:[{value:'asc',label:'日期升序'},{value:'desc',label:'日期降序'},{value:'name',label:'姓名排序'},{value:'id',label:'学号排序'}],onInput:input=>{state.order=input.target.value;renderRows();}});
 const reset=button({label:'清除报名筛选',variant:'ghost',size:'sm',onClick:()=>{
  for(const key of ['search','date','position','session','status','campus','leave'])state[key]='';
  state.order='asc';search.control.value='';for(const control of controls)control.control.value='';order.control.value='asc';renderRows();search.control.focus();
 }});
 function showDetails(row){
  if(onDetails)return onDetails(row);
  const participant=registrationParticipant(row,profiles.find(profile=>profile.accountId===row['账号ID'])||{});
  return openDrawer({title:`志愿者资料 · ${row['姓名']}`,body:[definitionList([
   ['姓名',row['姓名']],['学号',row['学号']],['邮箱',row['邮箱']||participant.email||'未提供'],['校区',participant.campus||'未提供'],['院系',participant.department||'未提供'],['年级',participant.grade||'未提供'],['性别',participant.gender||'未提供'],['电话',participant.phone||'未提供'],['QQ',participant.qq||'未提供'],['急救证',participant.certificate||'未知'],['活动类别',row['活动类别']||'未分类'],['地区',row['地区']||'未提供'],['备注',row['备注']||'无'],['备注2',row['备注2']||'无'],['注意事项',row['注意事项']||'无'],['资料来源',row['资料来源']||'历史报名资料'],['关联状态',row['关联状态']||'待完善']
  ])]});
 }
 function secondaryActions(row){
  return h('div',{class:'activity-legacy-roster__secondary'},
   button({label:'更多资料',size:'sm',variant:'ghost',onClick:()=>showDetails(row)}),
   canApprove(row)?button({label:'拒绝录取并通知',size:'sm',disabled:busy,onClick:()=>onReason?.('拒绝录取并通知',`/registrations/${row._id}/reject`)}):null,
   row['请假状态']==='待审批'?[
    button({label:'批准请假',size:'sm',disabled:busy,onClick:()=>onReason?.('批准请假',`/registrations/${row._id}/leave-approve`)}),
    button({label:'驳回请假',size:'sm',disabled:busy,onClick:()=>onReason?.('驳回请假',`/registrations/${row._id}/leave-reject`)})
   ]:null);
 }
 function renderRow(row,number){
  const value=rowContext(row),pending=canApprove(row);
  return h('tr',{class:'activity-person',data:{registrationId:row._id}},
   h('td',{'data-label':'序号','data-roster-column':'序号',text:String(number)}),
   h('td',{class:'activity-legacy-roster__select','data-label':'选择','data-roster-column':'选择'},selectable(row)?h('input',{type:'checkbox',checked:state.selected.has(row._id),disabled:busy,'aria-label':`选择${row['姓名']}`,on:{change:input=>{if(input.target.checked)state.selected.add(row._id);else state.selected.delete(row._id);updateCount();}}}):null),
   h('th',{scope:'row',class:'activity-legacy-roster__person','data-label':'姓名','data-roster-column':'姓名'},h('strong',{text:row['姓名']||'未提供姓名'})),
   h('td',{'data-label':'学号','data-roster-column':'学号',text:row['学号']||'未提供学号'}),
   h('td',{'data-label':'部门','data-roster-column':'部门',text:row['部门']||profiles.find(profile=>profile.accountId===row['账号ID'])?.organizationDepartment||'未提供'}),
   h('td',{class:'activity-legacy-roster__context','data-label':'日期 / 班次','data-roster-column':'日期 / 班次'},h('span',{text:`${value.date||'日期待完善'} ${value.slot}`}),h('span',{class:'t-caption',text:[value.campus,value.location].filter(Boolean).join(' · ')||'地点待完善'})),
   h('td',{class:'activity-legacy-roster__status','data-label':'状态','data-roster-column':'报名 / 请假'},badge(result(row),{tone:['已确认','已签到'].includes(row['报名状态'])?'success':'warning'}),row['请假状态']?h('span',{class:'t-caption',text:`请假${row['请假状态']}`}):null,row['请假原因']?h('span',{class:'t-caption',text:`请假：${row['请假原因']}`}):null,row['处理说明']?h('span',{class:'t-caption',text:row['处理说明']}):null),
   h('td',{class:'activity-legacy-roster__actions','data-label':'操作','data-roster-column':'操作'},
    pending?button({label:'批准录取并通知',variant:'primary',size:'sm',disabled:busy,onClick:()=>onApprove?.(row)}):null,
    h('details',{class:'activity-legacy-roster__more',open:!window.matchMedia('(max-width: 860px)').matches},h('summary',{text:'操作','aria-label':`${row['姓名']}的操作`}),secondaryActions(row))));
 }
 let currentRows=[],eligible=[];
 function updateCount(){
  count.textContent=`显示 ${currentRows.length} / ${registrations.length} 条 · 可处理 ${eligible.length} 条 · 已选 ${state.selected.size} 条`;
  select.disabled=busy||!currentRows.some(canApprove);selectLeave.disabled=busy||!onBatchLeave||!currentRows.some(pendingLeave);
  deselect.disabled=busy||!state.selected.size;
  approve.disabled=busy||state.selectionMode!=='approval'||!state.selected.size;
  approveLeave.disabled=rejectLeave.disabled=busy||!onBatchLeave||state.selectionMode!=='leave'||!state.selected.size;
 }
 function renderRows(){
  currentRows=visibleRows();eligible=currentRows.filter(selectable);
  const ids=new Set(eligible.map(row=>row._id));for(const id of state.selected)if(!ids.has(id))state.selected.delete(id);
  updateCount();
  const groups=new Map();
  for(const row of currentRows){
   const value=rowContext(row),entry=positions.entryFor(row),key=entry?.label||value.position||'';
   if(!groups.has(key))groups.set(key,{number:entry?.number||Number.MAX_SAFE_INTEGER,label:entry?`${entry.label} · ${entry.name||value.position||'未命名岗位'}`:value.position||'不限岗位',rows:[]});
   groups.get(key).rows.push(row);
  }
  const table=h('table',{class:'activity-legacy-roster__table','aria-label':'报名与请假名单'},
   h('thead',{},h('tr',{},...['序号','选择','姓名','学号','部门','日期 / 班次','报名 / 请假','操作'].map(label=>h('th',{scope:'col','data-roster-column':label,text:label})))));
  let number=0;
  for(const group of [...groups.values()].sort((a,b)=>a.number-b.number||compare(a.label,b.label))){
   const rows=group.rows,sessions=new Map();for(const row of rows){const value=rowContext(row),key=JSON.stringify([value.date,value.slot,value.session]);if(!sessions.has(key))sessions.set(key,{value,rows:[]});sessions.get(key).rows.push(row);}
   const body=h('tbody',{},h('tr',{class:'activity-legacy-roster__group'},h('th',{colspan:8,'data-roster-group':'true',scope:'rowgroup',text:`${group.label} · ${rows.length} 人`})));
   const sessionsSorted=[...sessions.values()].sort((a,b)=>(compare(a.value.date,b.value.date)||compare(a.value.slot,b.value.slot)||compare(a.value.session,b.value.session))*(state.order==='desc'?-1:1));
   for(const session of sessionsSorted){
    body.append(h('tr',{class:'activity-legacy-roster__session'},h('th',{colspan:8,'data-roster-group':'true',text:`${session.value.date||'日期待完善'} ${session.value.slot} · ${session.value.location||'地点待完善'} · ${session.rows.length} 人`})));
    session.rows.sort((a,b)=>compare(state.order==='name'?a['姓名']:state.order==='id'?a['学号']:a['创建时间'],state.order==='name'?b['姓名']:state.order==='id'?b['学号']:b['创建时间'])*(state.order==='desc'?-1:1)||compare(a._id,b._id));
    body.append(...session.rows.map(row=>renderRow(row,++number)));
   }
   table.append(body);
  }
  columns.apply(table);
  records.replaceChildren(currentRows.length?table:emptyState({title:registrations.length?'没有符合筛选条件的报名':'暂无报名记录',description:registrations.length?'请调整或清除筛选条件。':'审批并发布活动后，报名记录会显示在这里。'}));
 }
 const resultPanel=panel({title:'报名与请假',body:h('div',{class:'stack-4 activity-legacy-roster'},
  directoryError?notice('志愿者补充资料暂不可用，以下仍显示报名时保存的资料。',{tone:'warning'}):null,
  showLegend&&positions.legend?h('p',{class:'t-caption activity-legacy-roster__legend',text:positions.legend}):null,
  h('div',{class:'activity-roster-filters activity-legacy-roster__filters'},...(compact?[search,date,status]:[search,date,position,session,status,campus,leave,order,reset])),
  h('div',{class:'activity-legacy-roster__batch'},count,select,selectLeave,deselect,approve,approveLeave,rejectLeave,columns.control),records)});
 renderRows();return resultPanel;
}
