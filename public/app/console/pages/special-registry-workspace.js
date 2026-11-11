import {registryOpenStatus} from '../../shared/special-activity.js';
import {searchField} from '../../ui/search-field.js';
import {h} from '../../core/dom.js';
import {request,getSessionState,downloadFile} from '../../core/api.js';
import {button,field,notice,definitionList} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';
import {serviceWorkspace} from './activity-service.js';
import {hoursWorkspace} from './hours-workspace.js';
import {editAdminActivityInformation} from './activity-admin-information.js';

export function specialRegistryWorkspace({event,data,onChanged}){
 const root=`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}`,node=h('div',{class:'activity-legacy-workspace'}),toolbar=h('div',{class:'activity-draft-toolbar row-wrap'}),body=h('div',{class:'activity-registration-content stack-3'}),user=getSessionState().user,actor=user?.accountId||user?.username,superAdmin=user?.role==='super_admin';
 const component=JSON.parse(event['报名页配置']).special.type==='component-donation';let selected=new Set(),batch=false,busy=false,disposed=false,sub=null;const state={};
 node.append(toolbar,body);
 const switchTab=async task=>{
  if(busy||sub?.isSaving?.()||sub?.hasUnsaved?.()&&!await confirmAction({title:'放弃未保存的修改？',confirmLabel:'放弃修改'}))return;
  sub?.dispose?.();sub=null;
  if(task==='records'){await renderRecords();return;}
  sub=task==='hours'?hoursWorkspace({event,actor,superAdmin,state:state.hours||=( {}),onSaved:onChanged}):serviceWorkspace({event,events:data.events,registrations:data.registrations,ledger:data.ledger,kind:'checkins',actor,superAdmin,state:state.checkins||=({}),onSaved:onChanged});body.replaceChildren(sub.node||sub);
 };
 function reasonDialog(title,action){
  const reason=field({label:'处理说明',multiline:true,required:true,maxlength:400});let drawer,saving=false;
  const commit=button({label:'确认',variant:'primary',onClick:async()=>{if(saving||!reason.control.reportValidity()||!reason.control.value.trim())return;saving=true;busy=true;commit.disabled=true;try{await action(reason.control.value.trim());await drawer.close();await onChanged();}catch(error){reportError(error,'操作结果需核对，请刷新查看');}finally{saving=false;busy=false;commit.disabled=false;}}});
  drawer=openDrawer({title,body:reason,footer:[button({label:'取消',onClick:()=>drawer.close()}),commit]});drawer.setCloseGuard(()=>!saving);
 }
 toolbar.append(button({label:'查看活动信息',onClick:()=>openDrawer({title:'活动信息',body:definitionList([['名称',event['活动名称']],['类别','排班专项'],['活动时间','长期，直至管理员手动结束'],['地点',event['地点']],['说明',event['通知草稿']]])})}),...(superAdmin?[button({label:'修改活动信息',onClick:()=>editAdminActivityInformation(event,onChanged)})]:[]),button({label:'登记记录',onClick:()=>switchTab('records')}),...(!component?[button({label:'历史签到与初审',onClick:()=>switchTab('checkins')})]:[]),button({label:'终审与导出',onClick:()=>switchTab('hours')}),h('span',{class:'spacer'}),...(registryOpenStatus(event['状态'])?[button({label:'结束登记',variant:'ghost',onClick:()=>reasonDialog('结束本项目登记？',reason=>request(root+'/registry-end',{method:'POST',body:{reason}}))})]:[]));
 async function renderRecords(){
  body.replaceChildren(notice('正在读取登记记录…',{tone:'neutral'}));const loaded=await request(root+'/registry',{fresh:true});if(disposed)return;
  const rows=loaded.rows,search=searchField({label:'搜索登记记录',placeholder:'姓名、学号、日期或岗位',onSearch:()=>render()}),summary=h('span',{class:'t-caption',text:`登记人数 ${new Set(rows.map(r=>r.studentId)).size} · 登记记录 ${rows.length}`}),table=h('div',{class:'activity-registration-table registry-table'}),tools=h('div',{class:'row-2 row-wrap'});
  const targets=()=>rows.filter(r=>selected.has(r._id)&&r.registry?.state==='pending');
  const verify=button({label:'核验通过所选',variant:'primary',onClick:()=>reasonDialog(component?'核验献血证并提交时长初审':'确认所选服务登记',reason=>request(root+'/registry-decisions',{method:'POST',body:{items:targets().map(r=>({id:r._id,revision:r.registry.revision})),decision:'verify',reason}}))}),sendBack=button({label:'退回所选',onClick:()=>reasonDialog('退回所选登记',reason=>request(root+'/registry-decisions',{method:'POST',body:{items:targets().map(r=>({id:r._id,revision:r.registry.revision})),decision:'return',reason}}))});
  function render(){
   const visible=rows.filter(r=>[r.name,r.studentId,r.date,r.registry?.location].join(' ').includes(search.input.value.trim()));verify.hidden=sendBack.hidden=!batch;verify.disabled=sendBack.disabled=busy||!targets().length;
   table.replaceChildren(h('table',{class:'table'},h('thead',{},h('tr',{},...(batch?['选择']:[]).concat(['服务日期',...(!component?['服务时间','岗位']:[]),'姓名','学号','部门','邮箱','校区'],component?['献血量']:[],['状态','操作']).map(text=>h('th',{text})))),h('tbody',{},...visible.map(row=>h('tr',{},...(batch?[h('td',{},h('input',{type:'checkbox',disabled:row.registry?.state!=='pending',checked:selected.has(row._id),'aria-label':'选择 '+row.name,on:{change:e=>{if(e.target.checked)selected.add(row._id);else selected.delete(row._id);render();}}}))]:[]),...[row.date,...(!component?[row.registry?.start?row.registry.start+'–'+row.registry.end:row.time||'—',row.registry?.location||row.position||'—']:[]),row.name,row.studentId,row.department,row.email,row.campus,...(component?[row.registry?.quantity]:[]),row.registry?.state==='verified'?'已核验':row.registry?.state==='returned'?'已退回':'待核验'].map(text=>h('td',{text})),h('td',{},row.registry?.photoId?button({label:'查看凭证',size:'sm',onClick:()=>openDrawer({title:row.name+' · 登记凭证',body:h('img',{class:'attendance-photo',src:`/api/volunteer/workflow/registrations/${encodeURIComponent(row._id)}/registry-certificate`,alt:'登记凭证'})})}):null)))),!visible.length?h('tbody',{},h('tr',{},h('td',{colspan:(batch?1:0)+10,class:'registry-empty',text:'暂无登记记录'}))):null));
  }
  tools.append(search,button({label:batch?'退出批量操作':'批量操作',onClick:async()=>{batch=!batch;selected.clear();await renderRecords();}}),...(batch?[button({label:'全选当前待核验',onClick:()=>{for(const row of rows.filter(r=>r.registry?.state==='pending'&&[r.name,r.studentId,r.date,r.registry?.location].join(' ').includes(search.input.value.trim())))selected.add(row._id);render();}})]:[]),verify,sendBack,button({label:'导出当前项目',onClick:()=>downloadFile(root+'/registry-export.xlsx',event['活动名称']+'登记记录.xlsx').catch(error=>reportError(error,'导出失败'))}));
  body.replaceChildren(h('div',{class:'registry-summary'},summary),tools,component?notice('凭证核验通过仅生成待终审的时长记录，不会自动入账。',{tone:'neutral'}):notice('凭证核验通过后生成待终审时长；旧的仅日期记录仍可通过历史签到与初审处理。',{tone:'neutral'}),table);render();
 }
 void renderRecords().catch(error=>{if(!disposed)body.replaceChildren(notice(error.message||'登记记录读取失败',{tone:'warning'}));});
 return {node,dispose:()=>{disposed=true;sub?.dispose?.();},isSaving:()=>busy||sub?.isSaving?.(),hasUnsaved:()=>sub?.hasUnsaved?.()||false};
}
