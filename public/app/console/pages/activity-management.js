import {h,clear} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {panel,field,button,badge,notice,definitionList,emptyState,checkbox,runWithLoading} from '../../ui/primitives.js';
import {HALF_HOURS,filterRoster,noticeTemplate,syncNoticeSchedule,canDecideRegistration,selectedPendingIds,hasRegistrationResult,selectedResultIds} from '../../shared/activity-management.js';
import {rosterReview,rosterRow} from '../../shared/roster-review.js';
import {localizeActivityDate} from './activity-date.js';
const root='/api/volunteer/workflow';
const statusLabel = value => ({yes:'是',no:'否',unknown:'未提供'})[value] || '未提供';
export function rosterPanel(event, registrations, {refresh, directory, directoryError,viewState}) {
  const review=rosterReview(event),finalized=review?.phase==='final',committing=review?.phase==='publishing',editing=!finalized&&!committing&&event['状态']==='报名中';
  const savedState=viewState?.eventId===event._id&&viewState.finalized===finalized&&viewState.committing===committing?viewState:null;
  const filters={search:'',campus:[],certificate:'',core:'',status:finalized?'':'待筛选',order:'asc'};
  if(savedState)Object.assign(filters,savedState.filters,{campus:[...savedState.filters.campus]});
  const selected=new Set(),body=h('div',{class:'activity-roster',data:{editing:String(editing)}}),records=h('div',{class:'activity-roster-records'}),selection=h('div',{class:'activity-roster-selection'});
  const rows=registrations.map(r=>({...rosterRow(event,r),participant:directory.find(p=>p.accountId===r['账号ID'])||{}}));
  if(!savedState&&!rows.some(r=>r['报名状态']==='待筛选'))filters.status='';
  const eligible=r=>editing&&canDecideRegistration(r);
  const adjustable=r=>editing&&r['请假状态']!=='待审批'&&!r['签到照片ID']&&!r['签到行ID']&&['待筛选','已确认','未入选'].includes(r['报名状态']);
  const processed=hasRegistrationResult;
  let visible=[],selectable=[],selectAll;
  const rowChecks=new Map(),selectionCount=h('span',{class:'t-caption','aria-live':'polite'});
  const mailStates=new Map(),mailLabels=new Map();let mailSequence=0;
  function updateMailLabels(){
    for(const r of rows){const node=mailLabels.get(r._id);if(!node)continue;if(!finalized){node.textContent=processed(r)?r.rosterDraft?'暂定 · 未通知':'已公布结果':'';node.dataset.status='draft';continue;}const state=processed(r)?mailStates.get(r._id):{status:'not_sent'};
      const status=state?.status||'loading';node.textContent=({sent:'邮件已发送',failed:'邮件发送失败',not_sent:'邮件未发送',unknown:'邮件状态暂不可用',loading:'邮件状态加载中'})[status];node.dataset.status=status;
      node.title=status==='sent'?'邮件已交给邮件服务发送'+(state.sentAt?' · '+new Date(state.sentAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):''):'';
    }
  }
  async function loadMailStatuses(){
    const sequence=++mailSequence;
    try{const response=await request(`${root}/events/${event._id}/mail-status`);if(sequence!==mailSequence)return;for(const r of rows)if(processed(r))mailStates.set(r._id,{status:'unknown'});for(const item of response.items||[])mailStates.set(item.id,item);}
    catch{if(sequence!==mailSequence)return;for(const r of rows)if(processed(r))mailStates.set(r._id,{status:'unknown'});}
    updateMailLabels();
    const states=rows.filter(processed).map(r=>mailStates.get(r._id)?.status||'unknown'),sent=states.filter(s=>s==='sent').length,failed=states.filter(s=>s==='failed').length,unknown=states.filter(s=>s==='unknown').length;
    progress.textContent=`邮件已发送 ${sent} / ${states.length} 人${failed?' · 失败 '+failed+' 人':''}${unknown?' · '+unknown+' 人状态待核对':''}`;
    retryButton.hidden=sent===states.length;
    retryButton.querySelector('span').textContent=failed?`重试 ${failed} 封失败邮件`:unknown?'核对邮件状态':'继续发送通知';
  }
  const tabs=h('div',{class:'activity-roster-tabs',role:'group','aria-label':'报名状态'}),tabButtons=new Map();
  for(const [value,label] of [['待筛选','待确认'],['success',finalized?'报名成功':'拟录取'],['未入选',finalized?'报名失败':'拟不录取'],['','全部']]){
    const count=filterRoster(rows,{status:value}).length;
    const tab=button({label:`${label} ${count}`,onClick:()=>{filters.status=value;selected.clear();render();}});
    tabs.append(tab);tabButtons.set(value,tab);
  }
  const tools=h('div',{class:'activity-roster-filters',id:`roster-filters-${event._id}`});tools.hidden=!savedState?.filtersOpen;
  const chips=h('div',{class:'activity-roster-chips','aria-label':'已选筛选条件'}),filterFields=new Map();
  function filter(name,label,options){const f=field({label,value:filters[name],options,onInput:()=>{filters[name]=f.control.value;selected.clear();render();}});tools.append(f);filterFields.set(name,{field:f,label});}
  const search=field({label:'搜索报名',value:filters.search,placeholder:'搜索姓名或学号',onInput:()=>{filters.search=search.control.value;selected.clear();render();}});
  const toggleFilters=button({label:'筛选',onClick:()=>{tools.hidden=!tools.hidden;toggleFilters.setAttribute('aria-expanded',String(!tools.hidden));}});
  toggleFilters.setAttribute('aria-expanded',String(!tools.hidden));toggleFilters.setAttribute('aria-controls',tools.id);
  const order=field({label:'排序',value:filters.order,options:[{value:'asc',label:'最早报名优先'},{value:'desc',label:'最新报名优先'}],onInput:()=>{filters.order=order.control.value;render();}});
  const selectionTools=h('div',{class:'row-2 row-wrap'});selection.append(selectionTools,order);
  const campusButtons=new Map(),campusOptions=h('div',{class:'activity-campus-options'});
  function selectCampus(campus){
    filters.campus=campus?(filters.campus.includes(campus)?filters.campus.filter(value=>value!==campus):[...filters.campus,campus]):[];
    selected.clear();render();
  }
  for(const campus of ['',...[...new Set(rows.map(r=>r.participant.campus).filter(Boolean))].sort()]){
    const control=button({label:campus||'全部校区',size:'sm',onClick:()=>selectCampus(campus)});
    campusButtons.set(campus,control);campusOptions.append(control);
  }
  tools.append(h('fieldset',{class:'activity-campus-filter'},h('legend',{class:'field__label',text:'校区（可多选）'}),campusOptions));
  filter('certificate','急救证书',[{value:'',label:'全部证书情况'},{value:'yes',label:'有急救证书'},{value:'no',label:'无急救证书'},{value:'unknown',label:'未提供'}]);
  filter('core','红会核心成员',[{value:'',label:'全部成员情况'},{value:'yes',label:'是'},{value:'no',label:'否'},{value:'unknown',label:'未提供'}]);
  const progress=h('p',{class:'t-caption','aria-live':'polite'});
  let finalizeButton,reopenButton,retryButton;
  async function deliver(action,retry=false){
    finalizeButton.disabled=true;reopenButton.disabled=true;retryButton.disabled=true;
    try{
      let response=await request(`${root}/events/${event._id}/${action}`,{method:'POST',body:{token:event.rosterToken,retry}});
      while(true){
        const r=response.result;progress.textContent=`通知进度：已发送 ${r.delivered} / ${r.total} 人，失败 ${r.failedCount} 人`;
        if(!r.remaining){if(r.failedCount||r.unknown.length)notify.warning('名单已确认，部分通知需要处理','可重试失败邮件；状态待核对的邮件不会自动重发。');else notify.success('名单已确认，结果通知已完成');break;}
        response=await request(`${root}/events/${event._id}/notify-results`,{method:'POST',body:{}});
      }
    }catch(error){reportError(error,'提交或通知未完成，刷新后可继续');}
    finally{await refresh();}
  }
  const pending=rows.filter(r=>r['报名状态']==='待筛选').length,leaves=rows.filter(r=>r['请假状态']==='待审批').length;
  const pendingRegistrations=rows.filter(r=>r['报名状态']==='待筛选'&&r['请假状态']!=='待审批').length;
  const outstandingSummary=`还有 ${pendingRegistrations+leaves} 人未处理`;
  const successes=rows.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length,failures=rows.filter(r=>r['报名状态']==='未入选').length;
  finalizeButton=button({label:committing?'继续提交并发送邮件通知':'最终确认并发送邮件通知',variant:'primary',disabled:!committing&&(!editing||pending>0||leaves>0||!rows.length),onClick:async()=>{
    if(!await confirmAction({title:'最终确认这份名单？',description:`报名成功 ${successes} 人，报名失败 ${failures} 人，共 ${successes+failures} 人。确认后公布结果、关闭新报名并统一发送邮件通知；未变更且已发送的结果不会重复通知。`,confirmLabel:'确认并发送邮件通知'}))return;
    await deliver('finalize-roster');
  }});
  reopenButton=button({label:'修改已确认名单',variant:'ghost',disabled:event['状态']!=='报名中',onClick:async()=>{
    if(!await confirmAction({title:'重新调整名单？',description:'报名人暂时继续看到上一版结果。修改完成后需再次最终确认，仅结果发生变化的人收到新通知。',confirmLabel:'进入调整'}))return;
    try{await request(`${root}/events/${event._id}/reopen-roster`,{method:'POST',body:{token:event.rosterToken}});await refresh();}catch(error){reportError(error,'暂不能调整名单');}
  }});
  retryButton=button({label:'继续发送通知',onClick:()=>deliver('notify-results',true)});
  const finalActions=h('div',{class:'activity-roster-finalize'},h('div',{class:'stack-2'},h('strong',{text:finalized?'名单已最终确认':committing?'名单提交未完成':'名单调整中'}),h('p',{class:'t-caption',text:finalized?'报名结果已公布。通知失败可单独重试，不会重复发送成功邮件。':committing?'结果尚未统一公布，请继续完成提交。':outstandingSummary})),h('div',{class:'row-2 row-wrap'},...(finalized?[retryButton,reopenButton]:[finalizeButton])),progress);
  async function decide(decision,control){
    const ids=selectedPendingIds(rows,selected);if(!ids.length){notify.warning('请先选择待确认报名');return;}
    let reason='';
    if(decision==='reject'){
      const preset=field({label:'失败原因',options:['名额已满','不符合报名要求','时间不匹配','其他原因']});
      const note=field({label:'补充说明',multiline:true,maxlength:500});let drawer,b;
      b=button({label:`暂定 ${ids.length} 人不录取`,variant:'primary',onClick:async()=>{reason=[preset.control.value,note.control.value.trim()].filter(Boolean).join('：');if(reason.length>500){notify.warning('处理说明不能超过500字');return;}await apply(ids,decision,reason,b,()=>drawer.close());}});
      drawer=openDrawer({title:'拟不录取',description:'原因先保存为草稿，最终确认后才显示给报名人。',body:[preset,note],footer:[b]});return;
    }
    const count=rows.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length;
    if(!await confirmAction({title:`暂定录取 ${ids.length} 人？`,description:`本次拟录取 ${ids.length} 人，完成后共拟录取 ${count+ids.length} 人，推荐录取 ${event['容量']} 人。${count+ids.length>Number(event['容量'])?'本次将使用弹性名额。':''}`,confirmLabel:'保存暂定结果'}))return;
    await apply(ids,decision,reason,control);
  }
  async function apply(ids,decision,reason,control,close=()=>{}){
    try{await runWithLoading(control,async()=>{
      await request(`${root}/events/${event._id}/batch-decide`,{method:'POST',body:{ids,decision,reason,token:event.rosterToken}});
      close();notify.success(`已保存 ${ids.length} 人的暂定结果`);selected.clear();
      await refresh();
    });}catch(error){reportError(error,'处理未完成，请刷新名单核对');await refresh();}
  }
  let approve,reject;
  approve=button({label:'批量拟录取',variant:'primary',onClick:()=>decide('confirm',approve)});
  reject=button({label:'批量拟不录取',onClick:()=>decide('reject',reject)});

  const batch=h('div',{class:'activity-batch-actions','aria-label':'批量操作'},h('div',{class:'row-between row-wrap'},selectionCount,button({label:'取消选择',size:'sm',variant:'ghost',onClick:()=>{selected.clear();updateSelection();}})),h('div',{class:'row-2 row-wrap'},approve,reject));
  function updateSelection(){
    const count=selectable.filter(r=>selected.has(r._id)).length;
    selectAll.control.checked=selectable.length>0&&count===selectable.length;
    selectAll.control.indeterminate=count>0&&count<selectable.length;
    selectAll.control.disabled=!selectable.length;selectAll.dataset.checked=String(selectAll.control.checked);
    const pendingCount=selectedPendingIds(rows,selected).length,resultCount=selectedResultIds(rows,selected).length;
    selectionCount.textContent=`已选 ${count} 人 · 待确认 ${pendingCount} · 已有结果 ${resultCount}`;
    batch.hidden=!count;
    for(const [id,node] of rowChecks){node.control.checked=selected.has(id);node.dataset.checked=String(node.control.checked);node.closest('tr').dataset.selected=String(node.control.checked);}
    approve.disabled=reject.disabled=!selectedPendingIds(rows,selected).length;
  }
  async function revoke(r){
    try{await request(`${root}/events/${event._id}/batch-decide`,{method:'POST',body:{ids:[r._id],decision:'reset',token:event.rosterToken}});notify.success('已退回待确认，未发送邮件');await refresh();}catch(error){reportError(error,'撤销未完成');}
  }
  function render(){
    // Keep the visible list area when a shorter result would clamp the page scroll.
    if(records.isConnected){
      let scroller=records.parentElement;
      while(scroller&&!['auto','scroll'].includes(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement;
      const viewportHeight=scroller?.clientHeight||window.innerHeight;
      const viewportBottom=scroller?scroller.getBoundingClientRect().bottom:window.innerHeight;
      records.style.minHeight=`${Math.max(0,Math.min(viewportHeight,viewportBottom-records.getBoundingClientRect().top))}px`;
    }
    clear(records);clear(selectionTools);rowChecks.clear();mailLabels.clear();visible=filterRoster(rows,filters);
    for(const [value,tab] of tabButtons)tab.setAttribute('aria-pressed',String(filters.status===value));
    for(const [campus,control] of campusButtons)control.setAttribute('aria-pressed',String(campus?filters.campus.includes(campus):!filters.campus.length));
    clear(chips);
    for(const campus of filters.campus)chips.append(button({label:`校区：${campus} ×`,size:'sm',ariaLabel:`清除${campus}筛选`,onClick:()=>selectCampus(campus)}));
    for(const [name,{field:f,label}] of filterFields)if(filters[name])chips.append(button({label:`${label}：${f.control.selectedOptions[0].textContent} ×`,size:'sm',ariaLabel:`清除${label}筛选`,onClick:()=>{filters[name]='';f.control.value='';selected.clear();render();}}));
    chips.hidden=!chips.childNodes.length;
    toggleFilters.querySelector('span').textContent=chips.childNodes.length?`筛选 · ${chips.childNodes.length}`:'筛选';
    selectable=visible.filter(adjustable);
    selectAll=checkbox({label:'全选当前结果',onChange:checked=>{for(const r of selectable)if(checked)selected.add(r._id);else selected.delete(r._id);updateSelection();}});
    selectionTools.append(...(editing?[selectAll]:[]),...(editing&&filters.status===''?[button({label:'仅选待确认',size:'sm',variant:'ghost',onClick:()=>{selected.clear();for(const r of selectable)if(eligible(r))selected.add(r._id);updateSelection();}})]:[]),h('span',{class:'t-caption',text:`显示 ${visible.length} 人`}));
    if(!visible.length)records.append(emptyState({title:'没有符合条件的报名',description:'调整筛选条件后重试。'}));
    const tableBody=h('tbody');
    if(visible.length)records.append(h('table',{class:'activity-roster-table','aria-label':'报名名单'},
      h('colgroup',{},...[...(editing?['check']:[]),'name','campus','certificate','core','result','actions'].map(name=>h('col',{class:`activity-roster-col-${name}`}))),
      h('thead',{},h('tr',{},...['选择','姓名 / 学号','校区','急救证','核心成员',finalized?'报名结果 / 邮件':'暂定结果','操作'].map(label=>h('th',{scope:'col',text:label})))),tableBody));
    for(const r of visible){const p=r.participant;const label=r['报名状态']==='未入选'?(r.rosterDraft?'拟不录取':'报名失败'):r['报名状态']==='已确认'?(r.rosterDraft?'拟录取':'报名成功'):r['报名状态']==='待筛选'?'待确认':r['报名状态'];
      const check=selectable.includes(r)?checkbox({label:'',checked:selected.has(r._id),onChange:checked=>{if(checked)selected.add(r._id);else selected.delete(r._id);updateSelection();}}):null;
      if(check){check.control.setAttribute('aria-label',`选择 ${r['姓名']}`);rowChecks.set(r._id,check);}
      const mailLabel=h('span',{class:'activity-mail-status','aria-live':'polite'});mailLabels.set(r._id,mailLabel);
      const actions=h('div',{class:'row-2 row-wrap'},button({label:'更多资料',size:'sm',onClick:()=>openDrawer({title:`志愿者资料 · ${r['姓名']}`,body:[definitionList([['姓名',r['姓名']],['学号',r['学号']],['校区',p.campus||'未提供'],['院系',p.department||r['院系']||'未提供'],['年级',p.grade||'未提供'],['性别',p.gender||'未提供'],['邮箱',p.email||r['邮箱']],['手机号',p.phone||'未提供'],['微信',p.wechat||'未提供'],['QQ',p.qq||'未提供'],['急救证书',p.certificate||statusLabel(p.certificateStatus)],['红会核心成员',statusLabel(p.coreMemberStatus)],['岗位',r['岗位']||'不限岗位'],['请假状态',r['请假状态']||'无'],['请假原因',r['请假原因']||'无']])]})}),
        adjustable(r)&&processed(r)?button({label:r.rosterDraft?'撤销暂定':'调整结果',size:'sm',variant:'ghost',onClick:()=>revoke(r)}):null,
        !committing&&r['请假状态']==='待审批'?button({label:'处理请假',size:'sm',onClick:()=>{const reason=field({label:'处理说明',multiline:true,maxlength:500});let d;const act=approved=>button({label:approved?'批准请假':'驳回请假',onClick:async()=>{if(!reason.control.value.trim()){notify.warning('请填写处理说明');return;}try{await request(`${root}/registrations/${r._id}/${approved?'leave-approve':'leave-reject'}`,{method:'POST',body:{reason:reason.control.value}});d.close();await refresh();}catch(error){reportError(error,'请假处理失败');}}});d=openDrawer({title:'处理请假',body:[notice(r['请假原因'],{tone:'warning'}),reason],footer:[act(true),act(false)]});}}):null);
      const created=r['创建时间']?new Date(r['创建时间']).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
      const cell=(label,...children)=>h('td',{data:{label}},...children);
      tableBody.append(h('tr',{class:'activity-person',data:{registrationId:r._id}},
        h('td',{class:'activity-person-check'},check),
        h('td',{class:'activity-person-name'},h('strong',{text:r['姓名']}),h('span',{class:'t-caption',text:r['学号']}),h('span',{class:'activity-person-time',text:created,title:'报名时间'})),
        cell('校区',p.campus||'未提供'),cell('急救证',statusLabel(p.certificateStatus)),cell('核心成员',statusLabel(p.coreMemberStatus)),
        h('td',{class:'activity-person-result-cell'},h('div',{class:'activity-person-result'},badge(label,{tone:r['报名状态']==='待筛选'?'warning':r.rosterDraft?'neutral':['报名成功','已签到'].includes(label)?'success':label==='报名失败'?'danger':'warning'}),mailLabel),r['处理说明']?h('span',{class:'activity-person-note',text:r['处理说明']}):null),
        h('td',{class:'activity-person-actions'},actions)));
    }
    updateSelection();
    updateMailLabels();
  }
  const confirmed=rows.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length;
  body.getViewState=()=>({eventId:event._id,finalized,committing,filters:{...filters,campus:[...filters.campus]},filtersOpen:!tools.hidden});
  body.append(h('div',{class:'activity-roster-summary'},h('span',{text:'推荐录取 '+event['容量']+' 人'}),h('strong',{text:(finalized?'已录取 ':'拟录取 ')+confirmed+' 人'})),...(directoryError?[notice('志愿者资料暂未加载成功，请刷新重试。未提供的证书和成员身份不会被视为“否”。',{tone:'warning'})]:[]),finalActions,tabs,h('div',{class:'activity-roster-search'},search,toggleFilters),tools,chips,selection,records,batch);render();
  if(finalized)void loadMailStatuses();
  return panel({title:'名单确认',description:finalized?'报名结果与通知状态分开显示。':'',body});
}

export function publicationPanel(event,{config,mutate,editable}) {
  const initialText=event['通知草稿']||noticeTemplate(config);
  const initialTime=config.publishAt?.slice(0,16)||'';
  const body=h('div',{class:'stack-4'});
  const text=field({label:'报名通知正文',value:initialText,multiline:true,rows:16,maxlength:5000,disabled:!editable,hint:'预设内容可以全部修改，包括标题、时间、地点、内容、福利、报名要求和报名链接。'});
  text.control.required=true;
  const scheduleDate=localizeActivityDate(field({label:'报名开始日期（北京时间）',type:'date',value:initialTime.slice(0,10),disabled:!editable}));
  const scheduleTime=field({label:'报名开始时间（北京时间）',value:initialTime.slice(11,16),options:[{value:'',label:'请选择'},...HALF_HOURS],disabled:!editable});
  const scheduleValue=()=>scheduleDate.control.value&&scheduleTime.control.value?scheduleDate.control.value+'T'+scheduleTime.control.value:'';
  const schedule=h('div',{class:'stack-3'},h('div',{class:'activity-schedule-grid'},scheduleDate,scheduleTime),h('p',{class:'field__hint',text:'不设置定时则立即发布。'}));
  const countdown=h('p',{class:'t-caption',hidden:!config.publishAt,data:{publishCountdown:config.publishAt||''}});
  const dirtyNotice=notice('有未保存的修改，请先保存通知，再审批或发布。',{tone:'warning'});dirtyNotice.hidden=true;
  let publish,save;
  function update(){
    scheduleDate.refreshDate();
    scheduleDate.control.setCustomValidity(scheduleTime.control.value&&!scheduleDate.control.value?'请选择报名开始日期':'');
    scheduleTime.control.setCustomValidity(scheduleDate.control.value&&!scheduleTime.control.value?'请选择报名开始时间':'');
    const dirty=text.control.value!==initialText||scheduleDate.control.value!==initialTime.slice(0,10)||scheduleTime.control.value!==initialTime.slice(11,16);dirtyNotice.hidden=!dirty;if(publish)publish.disabled=dirty;if(save)save.disabled=!dirty;
  }
  function updateSchedule(){
    if(editable)text.control.value=syncNoticeSchedule(text.control.value,scheduleValue());
    update();
  }
  text.control.addEventListener('input',update);scheduleDate.control.addEventListener('input',updateSchedule);scheduleTime.control.addEventListener('change',updateSchedule);
  const actions=h('div',{class:'row-2 row-wrap'});
  if(editable){
    save=button({label:'保存通知',variant:event['状态']==='可发布'?'secondary':'primary',onClick:async()=>{
      if(!text.control.reportValidity()||!scheduleDate.control.reportValidity()||!scheduleTime.control.reportValidity())return;
      try{await runWithLoading(save,()=>mutate('/events/'+event._id+'/notice',{text:text.control.value,publishAt:scheduleValue()?scheduleValue()+'+08:00':''},'PATCH'));}catch(error){reportError(error,'通知未保存');}
    }});
    actions.append(save,button({label:'恢复预设模板',onClick:async()=>{
      if(text.control.value!==noticeTemplate({...config,publishAt:scheduleValue()?scheduleValue()+'+08:00':''})&&!await confirmAction({title:'恢复预设模板？',description:'当前正文将被活动配置生成的模板替换。恢复后仍需点击保存通知。',confirmLabel:'恢复模板'}))return;
      text.control.value=noticeTemplate({...config,publishAt:scheduleValue()?scheduleValue()+'+08:00':''});update();
    }}),button({label:'取消定时',variant:'secondary',onClick:()=>{scheduleDate.control.value='';scheduleTime.control.value='';updateSchedule();}}));
  }
  if(event['状态']==='可发布'){
    publish=button({label:config.publishAt&&Date.parse(config.publishAt)>Date.now()?'启动定时发布':'发布报名',variant:'primary',onClick:async()=>{try{await runWithLoading(publish,()=>mutate('/events/'+event._id+'/publish'));}catch(error){reportError(error,'发布未完成');}}});
  }
  actions.append(button({label:'复制当前正文',onClick:async()=>{try{await navigator.clipboard.writeText(text.control.value);notify.success('已复制当前正文');}catch(error){reportError(error,'复制失败');}}}));
  body.append(text,schedule,countdown,dirtyNotice,actions);
  if(publish)body.append(h('div',{class:'activity-publication-submit'},publish));
  if(editable&&initialTime)updateSchedule();else update();
  return panel({title:'发布报名通知',description:editable?'模板仅提供预设值，正文可自由编辑。保存修改后需重新提交审批。':'通知已发布，以下为已保存的内容。',body});
}
