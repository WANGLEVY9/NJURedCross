import {leaveReviewActions,leaveStatus,canReviewLeave} from './activity-leave-review.js';
import {rosterColumns} from '../roster-columns.js';
import {registrationCapacity} from '../../shared/activity-registration.js';
import {successMailEditor} from './success-mail-composer.js';
import {h,clear} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import { summarizeRosterDraftResult } from '../batch-result.js';
import { protectDrawerDraft } from '../../ui/drawer-draft.js';
import {panel,field,button,badge,notice,definitionList,emptyState,checkbox,runWithLoading} from '../../ui/primitives.js';
import {filterRoster,noticeTemplate,canDecideRegistration,selectedPendingIds,hasRegistrationResult,selectedResultIds} from '../../shared/activity-management.js';
import {rosterReview,rosterRow} from '../../shared/roster-review.js';
import {enhanceDateTimeField} from '../../ui/date-time-picker.js';
import {activityWindow,positionWithinActivity} from '../../shared/activity-window.js';
import {registrationParticipant} from '../../shared/registration-profile.js';
import {createPositionLabels} from '../../shared/position-labels.js';
const root='/api/volunteer/workflow';
const statusLabel = value => ({yes:'是',no:'否',unknown:'未提供'})[value] || '未提供';
export function openRosterLeaveDrawer(row, { refresh }) {
  const reason = field({
    label: '处理说明',
    multiline: true,
    maxlength: 500,
  });
  let submitting = false;
  let drawer;
  let draftProtection;

  const actionButton = (approved) => {
    const control = button({
      label: approved ? '批准请假' : '驳回请假',
      onClick: async () => {
        if (submitting) return;
        if (!reason.control.value.trim()) {
          notify.warning('请填写处理说明');
          return;
        }

        submitting = true;
        try {
          await runWithLoading(control, () =>
            request(
              `${root}/registrations/${row._id}/${
                approved ? 'leave-approve' : 'leave-reject'
              }`,
              {
                method: 'POST',
                body: { reason: reason.control.value },
              },
            ));
          draftProtection.release();
          drawer.close();

          try {
            await refresh();
          } catch (error) {
            reportError(error, '请假处理已保存，名单刷新失败');
          }
        } catch (error) {
          reportError(error, '请假处理失败');
        } finally {
          submitting = false;
        }
      },
    });
    return control;
  };

  drawer = openDrawer({
    title: '处理请假',
    body: [
      notice(row['请假原因'], { tone: 'warning' }),
      reason,
    ],
    footer: [actionButton(true), actionButton(false)],
  });
  draftProtection = protectDrawerDraft(drawer, {
    isBusy: () => submitting,
  });
}

export function rosterPanel(event, registrations, {refresh, directory, directoryError,viewState,events=[event]}) {
  let regional=false;try{regional=JSON.parse(event['报名页配置']||'{}').approval?.mode==='workspace-regional';}catch{/* Invalid configuration grants no new behavior. */}
  const review=rosterReview(event),finalized=review?.phase==='final',committing=review?.phase==='publishing',editing=!finalized&&!committing&&event['状态']==='报名中';
  const savedState=viewState?.eventId===event._id&&viewState.finalized===finalized&&viewState.committing===committing?viewState:null;
  const filters={search:'',campus:[],certificate:'',core:'',status:finalized?'':'待筛选',position:'',order:'asc'};
  if(savedState)Object.assign(filters,savedState.filters,{campus:[...savedState.filters.campus]});
  const selected=new Set(),body=h('div',{class:'activity-roster',data:{editing:String(editing)}}),records=h('div',{class:'activity-roster-records'}),selection=h('div',{class:'activity-roster-selection'});
  const rows=registrations.map(r=>({...rosterRow(event,r),participant:registrationParticipant(r,directory.find(p=>p.accountId===r['账号ID'])||{})}));
  const columns=rosterColumns({columns:['序号','选择','姓名','学号','部门','岗位 / 日期','校区','急救证','核心成员','报名结果 / 邮件','操作'],key:'registration-'+event._id});
  const positions=createPositionLabels({event,events,registrations});
  if(!savedState&&!rows.some(r=>r['报名状态']==='待筛选'))filters.status='';
  const eligible=r=>editing&&canDecideRegistration(r);
  if (Array.isArray(savedState?.selectedIds)) {
    const previouslySelected = new Set(savedState.selectedIds);
    for (const row of rows) {
      if (previouslySelected.has(row._id) && eligible(row)) {
        selected.add(row._id);
      }
    }
  }
  const adjustable=r=>editing&&r['请假状态']!=='待审批'&&!r['签到照片ID']&&!r['签到行ID']&&['待筛选','已确认','未入选'].includes(r['报名状态']);
  const processed=hasRegistrationResult;
  let visible=[],selectable=[],selectAll;
  const rowChecks=new Map(),selectionCount=h('span',{class:'t-caption','aria-live':'polite'});
  const mailStates=new Map(),mailLabels=new Map();let mailSequence=0;
  function updateMailLabels(){
    for(const r of rows){const node=mailLabels.get(r._id);if(!node)continue;if(r.rosterDraft){node.textContent=processed(r)?r.rosterDraft?'暂定 · 未通知':'已公布结果':'';node.dataset.status='draft';continue;}const state=processed(r)?mailStates.get(r._id):{status:'not_sent'};
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
  for(const [value,label] of [['待筛选','待确认'],['success','报名成功'],['未入选','报名失败'],['','全部']]){
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
  const order=field({label:'排序',value:filters.order,options:[{value:'asc',label:'最早报名优先'},{value:'desc',label:'最新报名优先'},{value:'name',label:'按姓名排列'},{value:'student',label:'按学号排列'}],onInput:()=>{filters.order=order.control.value;render();}});
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
  filter('position','岗位',[{value:'',label:'全部岗位'},...[...new Set(rows.map(r=>r['岗位']).filter(Boolean))].map(value=>({value,label:value}))]);
  filter('date','报名日期',[{value:'',label:'全部日期'},...[...new Set(rows.map(r=>r['报名日期']).filter(Boolean))].sort().map(value=>({value,label:value}))]);
  filter('leave','请假状态',[{value:'',label:'全部请假状态'},{value:'none',label:'未申请请假'},...['待审批','已批准','已驳回'].map(value=>({value,label:value}))]);
  const progress=h('p',{class:'t-caption','aria-live':'polite'});
  let finalizeButton,reopenButton,retryButton;
  async function deliver(action,retry=false){
    finalizeButton.disabled=true;reopenButton.disabled=true;retryButton.disabled=true;
    try{
      let response=await request(`${root}/events/${event._id}/${action}`,{method:'POST',body:{token:event.rosterToken,retry}});
      while(true){
        const r=response.result;progress.textContent=`通知进度：已发送 ${r.delivered} / ${r.total} 人，失败 ${r.failedCount} 人`;
        if(!r.remaining){if(r.failedCount||r.unknown.length)notify.warning('结果已保存，部分通知需要处理','可重试失败邮件；状态待核对的邮件不会自动重发。');else notify.success('结果已保存，通知处理已完成');break;}
        response=await request(`${root}/events/${event._id}/notify-results`,{method:'POST',body:{}});
      }
    }catch(error){reportError(error,'提交或通知未完成，刷新后可继续');}
    finally{await refresh();}
  }
  finalizeButton=button({label:'继续处理未完成的提交',variant:'primary',onClick:()=>deliver('finalize-roster')});
  reopenButton=button({label:'修改已确认名单',variant:'ghost',disabled:event['状态']!=='报名中',onClick:async()=>{
    if(!await confirmAction({title:'重新调整名单？',description:'报名人暂时继续看到上一版结果。调整报名结果后直接通知，仅结果发生变化的人收到新通知。',confirmLabel:'进入调整'}))return;
    try{await request(`${root}/events/${event._id}/reopen-roster`,{method:'POST',body:{token:event.rosterToken}});await refresh();}catch(error){reportError(error,'暂不能调整名单');}
  }});
  retryButton=button({label:'继续发送通知',onClick:()=>deliver('notify-results',true)});
  const finalActions=h('div',{class:'activity-roster-finalize'},h('p',{class:'t-caption',text:'报名结果提交后直接公布并发送邮件通知；发送失败可单独重试，不会重复发送成功邮件。'}),h('div',{class:'row-2 row-wrap'},retryButton,...(finalized?[reopenButton]:committing?[finalizeButton]:[])),progress);
  async function decide(decision,control){
    const ids=selectedPendingIds(rows,selected);if(!ids.length){notify.warning('请先选择待确认报名');return;}
    let reason='';
    if(decision==='reject'){
      const preset=field({
        label:'失败原因',
        options:['名额已满','不符合报名要求','时间不匹配','其他原因'],
      });
      const note=field({
        label:regional?'失败原因':'补充说明',
        value:regional?'很遗憾的通知您，您报名的活动已满':'',
        multiline:true,
        maxlength:500,
      });
      let drawer,b,draftProtection;
      let saving=false;
      let needsReconciliation=false;

      b=button({
        label:`确认 ${ids.length} 人报名失败并通知`,
        variant:'primary',
        onClick:async()=>{
          if(saving||applying)return;
          if(needsReconciliation){
            notify.warning(
              '请先核对最新名单',
              '本次结果尚未全部确认，不能直接重复提交。补充说明仍保留在此表单中。',
            );
            return;
          }

          reason=regional?note.control.value.trim():[preset.control.value,note.control.value.trim()]
            .filter(Boolean).join('：');
          if(!reason||reason.length>500){
            notify.warning('处理说明不能超过500字');
            return;
          }

          saving=true;
          try{
            await apply(ids,decision,reason,b,(summary)=>{
              if(
                summary.succeeded===ids.length &&
                summary.unknown===0
              ){
                draftProtection.release();
                drawer.close();
              }else{
                needsReconciliation=true;
              }
            });
          }finally{
            saving=false;
          }
        },
      });

      drawer=openDrawer({
        title:'报名失败',
        description:'确认后公布报名失败结果并发送邮件通知。',
        body:regional?[note]:[preset,note],
        footer:[b],
      });
      draftProtection=protectDrawerDraft(drawer,{
        isBusy:()=>saving||applying,
      });
      return;
    }
    const count=rows.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length;
    if(!await confirmAction({title:`批准录取 ${ids.length} 人？`,description:`批准后立即发送成功邮件。本次录取 ${ids.length} 人，完成后共录取 ${count+ids.length} 人，推荐录取 ${event['容量']} 人。${count+ids.length>Number(event['容量'])?'本次将使用弹性名额。':''}`,confirmLabel:'批准并发送成功邮件'}))return;
    await apply(ids,decision,reason,control);
  }
  async function apply(ids, decision, reason, control, close = () => {}) {
    if (applying) {
      notify.info('正在保存报名结果，请等待');
      return;
    }

    const submitted = ids.map(id => ({
      id,
      name: rows.find(row => row._id === id)?.['姓名'] || id,
    }));

    applying = true;
    try {
      await runWithLoading(control, async () => {
        let response = null;

        try {
          response = await request(
            `${root}/events/${event._id}/batch-decide`,
            {
              method: 'POST',
              body: {
                ids,
                decision,
                reason,
                token: event.rosterToken,
                immediate: true,
              },
            },
          );
        } catch {
          // An interrupted response cannot establish which drafts were saved.
        }

        if(response?.result?.mail?.remaining){
          try{
            while(response.result.mail.remaining){
              const next=await request(`${root}/events/${event._id}/notify-results`,{method:'POST',body:{}});
              response.result.mail=next.result;
            }
          }catch{response.result.mailPending=true;}
        }
        const summary = summarizeRosterDraftResult(submitted, response);

        for (const item of summary.items) {
          if (item.status === 'succeeded') selected.delete(item.id);
        }

        let refreshed = false;
        try {
          refreshed = await refresh() !== false;
        } catch {
          // Keep the received acknowledgement even if list refresh fails.
        }

        close(summary);

        let resultDrawer;
        resultDrawer = openDrawer({
          title: '报名处理结果',
          description: decision === 'confirm' ? '录取结果与通知' : '报名失败结果与通知',
          width: 640,
          body: [
            definitionList([
              ['本次提交', `${summary.items.length} 人`],
              ['处理成功', `${summary.succeeded} 人`],
              ['待核对', `${summary.unknown} 人`],
            ]),
            notice(decision==='confirm'?(response?.result?.mailPending||response?.result?.mail?.failedCount||response?.result?.mail?.unknown?.length?'录取已保存，部分邮件需要在名单中核对或重试。':'录取已保存并触发成功邮件发送，请在名单中查看送达服务状态。'):'报名失败结果已保存并触发邮件通知，请在名单中核对发送状态。', {
              tone: 'info',
            }),
            summary.unknown
              ? notice('部分结果不明确，请先核对最新名单，再决定是否重试。', {
                  tone: 'warning',
                })
              : null,
            !refreshed
              ? notice('名单刷新失败，请重新刷新核对。', {
                  tone: 'warning',
                })
              : null,
            h('div', { class: 'stack-4' },
              ...summary.items.map(item => panel({
                title: item.name,
                body: h('div', { class: 'stack-3' },
                  badge(
                    item.status === 'succeeded' ? '已保存' : '待核对',
                    { tone: item.status === 'succeeded' ? 'success' : 'warning' },
                  ),
                  h('p', { class: 't-secondary', text: item.message }),
                ),
              })),
            ),
          ].filter(Boolean),
          footer: [
            button({
              label: '完成',
              variant: 'primary',
              onClick: () => resultDrawer.close(),
            }),
          ],
        });
      });
    } catch (error) {
      reportError(error, '处理结果展示未完成，请刷新名单核对');
    } finally {
      applying = false;
    }
  }
  let approve,reject;
  let applying = false;
  approve=button({label:'批准录取并通知',variant:'primary',onClick:()=>decide('confirm',approve)});
  reject=button({label:'批量报名失败并通知',onClick:()=>decide('reject',reject)});

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
    clear(records);clear(selectionTools);rowChecks.clear();mailLabels.clear();visible=filterRoster(rows,filters);if(filters.order==='name'||filters.order==='student'){const key=filters.order==='name'?'姓名':'学号';visible.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''),'zh-CN'));}
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
    if(visible.length)records.append(h('table',{class:'activity-roster-table activity-roster-table--grouped','aria-label':'报名名单'},
      h('thead',{},h('tr',{},...['序号','选择','姓名','学号','部门','岗位 / 日期','校区','急救证','核心成员','报名结果 / 邮件','操作'].map(label=>h('th',{scope:'col','data-roster-column':label,text:label})))),tableBody));
    const grouped=new Map();
    for(const row of visible){const key=positions.entryFor(row)?.number||row['岗位']||'不限岗位';if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(row);}
    let number=0;
    for(const [,group]of [...grouped].sort(([a],[b])=>typeof a==='number'&&typeof b==='number'?a-b:String(a).localeCompare(String(b),'zh-CN'))){
      const first=group[0];tableBody.append(h('tr',{class:'activity-roster-group'},h('th',{scope:'rowgroup',colspan:11,'data-roster-group':'true',text:`${positions.labelFor(first)} · ${first['岗位']||'整体报名'} · ${group.length} 人`})));
      for(const r of group){const p=r.participant;const label=['待审批','已批准'].includes(r['请假状态'])?leaveStatus(r):r['报名状态']==='未入选'?(r.rosterDraft?'拟不录取':'报名失败'):r['报名状态']==='已确认'?(r.rosterDraft?'拟录取':'报名成功'):r['报名状态']==='待筛选'?'待确认':r['报名状态'];
      const check=selectable.includes(r)?checkbox({label:'',checked:selected.has(r._id),onChange:checked=>{if(checked)selected.add(r._id);else selected.delete(r._id);updateSelection();}}):null;
      if(check){check.control.setAttribute('aria-label',`选择 ${r['姓名']}`);rowChecks.set(r._id,check);}
      const mailLabel=h('span',{class:'activity-mail-status','aria-live':'polite'});mailLabels.set(r._id,mailLabel);
      const actions=h('div',{class:'row-2 row-wrap'},button({label:'更多资料',size:'sm',onClick:()=>openDrawer({title:`志愿者资料 · ${r['姓名']}`,body:[definitionList([['姓名',r['姓名']],['学号',r['学号']],['校区',p.campus||'未提供'],['院系',p.department||r['院系']||'未提供'],['年级',p.grade||'未提供'],['性别',p.gender||'未提供'],['邮箱',p.email||r['邮箱']],['手机号',p.phone||'未提供'],['微信',p.wechat||'未提供'],['QQ',p.qq||'未提供'],['急救证书',p.certificate||statusLabel(p.certificateStatus)],['红会核心成员',statusLabel(p.coreMemberStatus)],['岗位',r['岗位']||'不限岗位'],['请假状态',r['请假状态']||'无'],['请假原因',r['请假原因']||'无'],['活动类别',r['活动类型']?r['活动类别']||'未分类':'未分类'],['活动地区',r['地区']||'未提供'],['备注',r['备注']||'无'],['注意事项',r['注意事项']||'无'],['资料来源',r['资料来源']||'历史报名资料'],['关联状态',r['关联状态']||'待完善']])]})}),
        adjustable(r)&&r.rosterDraft?button({label:'发布此结果并通知',size:'sm',onClick:ev=>{const draft=review.drafts[r._id];return apply([r._id],draft.decision,draft.reason||'',ev.currentTarget);}}):null,
        adjustable(r)&&processed(r)?button({label:r.rosterDraft?'撤销暂定':'调整结果',size:'sm',variant:'ghost',onClick:()=>revoke(r)}):null,
        null);
      const created=r['创建时间']?new Date(r['创建时间']).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录';
      const cell=(label,...children)=>h('td',{data:{label,rosterColumn:label}},...children);
      tableBody.append(h('tr',{class:'activity-person',data:{registrationId:r._id}},
        h('td',{'data-roster-column':'序号','data-label':'序号',text:String(++number)}),
        h('td',{class:'activity-person-check','data-roster-column':'选择'},check),
        h('td',{class:'activity-person-name','data-roster-column':'姓名',title:`报名时间：${created} · 来源：${r['报名类型']||r['资料来源']||'未记录'}`},h('strong',{text:r['姓名']})),cell('学号',r['学号']||'未提供'),cell('部门',r['部门']||p.organizationDepartment||p.division||'未提供'),
        cell('岗位 / 日期',h('span',{text:positions.labelFor(r)}),h('small',{text:[r['报名日期'],r['报名时段']].filter(Boolean).join(' ')})),cell('校区',p.campus||'未提供'),cell('急救证',statusLabel(p.certificateStatus)),cell('核心成员',statusLabel(p.coreMemberStatus)),
        h('td',{class:'activity-person-result-cell','data-roster-column':'报名结果 / 邮件'},h('div',{class:'activity-person-result'},badge(label,{tone:r['报名状态']==='待筛选'?'warning':r.rosterDraft?'neutral':['报名成功','已签到'].includes(label)?'success':label==='报名失败'?'danger':'warning'}),mailLabel),r['请假原因']?h('span',{class:'activity-person-note',text:r['请假原因']}):null,r['处理说明']?h('span',{class:'activity-person-note',text:r['处理说明']}):null),
        h('td',{class:'activity-person-actions','data-roster-column':'操作'},r['请假状态']==='待审批'?leaveReviewActions(r,{enabled:!committing&&canReviewLeave(event),decide:(id,approved,reason)=>request(`${root}/registrations/${id}/${approved?'leave-approve':'leave-reject'}`,{method:'POST',body:{reason}}),refresh}):h('div',{class:'row-2 row-wrap'},eligible(r)?button({label:'批准录取',size:'sm',variant:'primary',onClick:async event=>{selected.clear();selected.add(r._id);await decide('confirm',event.currentTarget);}}):null,actions.firstChild,actions.childNodes.length?h('details',{class:'roster-more'},h('summary',{text:'处理选项'}),actions):null))));
      }
    }
    columns.apply(records.querySelector('table'));
    updateSelection();
    updateMailLabels();
  }
  const confirmed=rows.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length;
  body.getViewState = () => ({
    eventId: event._id,
    finalized,
    committing,
    filters: {
      ...filters,
      campus: [...filters.campus],
    },
    filtersOpen: !tools.hidden,
    selectedIds: [...selected],
  });
  const capacityState=registrationCapacity(event,registrations);
  if(regional&&capacityState.full)body.append(badge('报名中 · 报名已满',{tone:'warning'}));
  body.append(button({label:review?.confirmedAt?'查看成功邮件':'编辑成功邮件（可选）',onClick:()=>successMailEditor(event,refresh)}),...(rows.some(r=>r.rosterDraft)?[notice('有历史暂存结果尚未公布。可逐条发布并通知，或撤销暂定后重新处理；不会自动批量发送。',{tone:'info'})]:[]),h('div',{class:'activity-roster-summary'},h('span',{text:'推荐录取 '+event['容量']+' 人'}),h('strong',{text:'已录取 '+confirmed+' 人'})),...(directoryError?[notice('志愿者资料暂未加载成功，请刷新重试。未提供的证书和成员身份不会被视为“否”。',{tone:'warning'})]:[]),finalActions,tabs,h('div',{class:'activity-roster-search'},search,toggleFilters,columns.control),tools,chips,selection,records,batch);render();
  void loadMailStatuses();
  return panel({title:'报名管理',description:finalized?'报名结果与通知状态分开显示。':'',body});
}

export function publicationReadiness(event,config) {
  const plan=config.positionDraft||config.positionPlan,positions=plan?.positions||[];
  const grouped=config.bookingMode==='grouped';
  const positionsReady=!grouped||(positions.length>0&&Boolean(activityWindow(plan.deadline,config.window?.start))&&positions.every(p=>p.name?.trim()&&p.location?.trim()&&['鼓楼','仙林','浦口','苏州'].includes(p.campus)&&Number.isInteger(Number(p.capacity))&&Number(p.capacity)>0&&positionWithinActivity(p,config.window)));
  const scheduled=event['状态']==='报名中'&&Date.parse(config.publishAt)>Date.now();
  // Group configuration can close registration while older parent records stay
  // 报名中. Re-publication is idempotent; the API rechecks approval and all children.
  const approved=event['状态']==='可发布'||scheduled||(grouped&&Boolean(config.positionPlan)&&event['状态']==='报名中');
  const label=scheduled?'定时发布 · 报名尚未开始':event['状态']==='可发布'&&!positionsReady?'待配置岗位':event['状态'];
  return {positionsReady,scheduled,approved,label,ready:approved&&positionsReady&&plan?.complete!==false};
}

export function publicationPanel(event,{config,mutate,editable,onDirty=()=>{},controlsOnly=false,onConfigure}) {
  const readiness=publicationReadiness(event,config);
  const alreadyOpen=event['状态']==='报名中'&&!readiness.scheduled;
  let baseline=event['通知草稿']||noticeTemplate(config),busy=false,conflict=false,needsApproval=false;
  const text=field({label:'报名通知正文',value:baseline,multiline:true,rows:16,maxlength:5000,disabled:!editable,hint:'显示在活动广场的报名详情中。按纯文本发布，保留换行。'});
  text.control.required=true;
  const localTime=value=>Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19):'';
  const schedule=enhanceDateTimeField(field({label:'定时发布时间（北京时间）',type:'datetime-local',step:1,value:localTime(config.publishAt),hint:alreadyOpen?'报名已开放，不能再改为定时发布，以免隐藏已有报名。':'精确到秒；审批通过且岗位配置完整后可设置。'}));
  const dirty=()=>text.control.value!==baseline;
  const preview=h('div',{class:'notification-preview__body'});
  const state=h('p',{class:'notification-save-state',role:'status'}),count=h('span',{class:'t-caption'});
  const publicationState=h('p',{class:'activity-publication__status',role:'status',text:readiness.scheduled?'定时发布 · 报名尚未开始 · '+localTime(config.publishAt).replace('T',' ')+'（北京时间）':readiness.label});
  const actions=h('div',{class:'row-2 row-wrap'});
  let save,submit;
  const plannedSchedule=Boolean(editable&&event['状态']==='草稿');
  const scheduleBaseline=()=>localTime(config.publishAt);
  const scheduleDirty=()=>plannedSchedule&&schedule.control.value!==scheduleBaseline();
  async function publishRequest(control,path,payload={}){
    if(busy||dirty()||conflict)return;
    busy=true;update();
    try{await runWithLoading(control,()=>mutate('/events/'+event._id+path,payload,'POST',()=>{busy=false;update();}));}
    catch(error){reportError(error,'发布设置未完成，请核对后重试');}
    finally{busy=false;update();}
  }
  const immediate=button({label:'立即发布',variant:'primary',onClick:()=>publishRequest(immediate,'/publish')});
  const scheduled=button({label:readiness.scheduled?'更新定时发布':'定时发布',onClick:()=>{
    if(alreadyOpen)return;
    const value=schedule.control.value;
    const publishAt=value?(value.length===16?value+':00':value)+'+08:00':'';
    const deadline=(config.positionDraft||config.positionPlan)?.deadline||config.registrationDeadline||config.window?.start;
    schedule.control.setCustomValidity(!value?'请选择定时发布时间':!Number.isFinite(Date.parse(publishAt))||Date.parse(publishAt)<=Date.now()?'请选择未来的时间':deadline&&Date.parse(publishAt)>=Date.parse(deadline)?'发布时间须早于报名截止或活动开始':'');
    if(schedule.control.reportValidity())return publishRequest(scheduled,'/schedule',{publishAt});
  }});
  const cancel=button({label:'取消定时发布',variant:'ghost',onClick:()=>publishRequest(cancel,'/schedule',{publishAt:null})});
  schedule.control.addEventListener('input',()=>schedule.control.setCustomValidity(''));
  const prerequisite=h('ul',{class:'activity-publication__prerequisites'},
    h('li',{text:readiness.approved?'审批已通过':'待完成审批'}),
    h('li',{text:(config.positionDraft||config.positionPlan)?.complete===false?'岗位保存未完成，请重试保存岗位安排':readiness.positionsReady?(config.bookingMode==='grouped'?'岗位已配置':'整体活动统一报名'):'请先配置有效的报名岗位及统一截止时间'}),
    h('li',{text:'发布前请保存通知；修改已批准正文后需要重新审批。'}));
  const workspace=h('section',{class:'activity-publication','aria-label':'发布工作区'},
    h('div',{},h('p',{class:'t-label',text:plannedSchedule?'第三步 · 通知与计划开放时间':'审批与发布'}),h('h3',{text:plannedSchedule?'完成通知后提交一次审批':'开放活动报名'}),publicationState),
    prerequisite,onConfigure&&!readiness.positionsReady?button({label:'配置报名岗位',variant:'primary',onClick:onConfigure}):null,
    h('div',{class:'activity-publication__controls'},schedule,h('div',{class:'activity-publication__actions'},immediate,scheduled,readiness.scheduled?cancel:null)),
    h('p',{class:'t-caption',text:plannedSchedule?'可选填计划开放时间。保存通知和岗位后提交审批；审核通过后仍须确认立即发布或定时发布，不会自动开放。':'立即发布将开放报名；定时发布将在指定北京时间开放报名。发布操作不会发送录取结果邮件。'}));
  function update(){
    text.control.disabled=!editable||busy;
    text.control.setCustomValidity(text.control.value.trim()?'':'请填写报名通知正文');
    state.textContent=conflict?'服务器记录已变化。请先复制当前正文，再退出编辑并刷新核对。':busy?'正在保存…':dirty()?'有未保存修改 · 保存后需提交审批':needsApproval?'通知已保存为草稿 · 请提交审批':editable?'当前内容已保存 · '+event['状态']:'只读记录 · '+readiness.label;
    preview.textContent=text.control.value||'填写正文后在这里预览';count.textContent=text.control.value.length+' / 5000 字';
    for(const control of actions.querySelectorAll('button'))control.disabled=busy||conflict;
    if(save)save.disabled=(!dirty()&&!scheduleDirty())||busy||conflict;
    if(submit)submit.disabled=busy||conflict||!readiness.positionsReady;
    immediate.disabled=!readiness.ready||needsApproval||dirty()||busy||conflict;
    scheduled.disabled=immediate.disabled||alreadyOpen;
    cancel.disabled=dirty()||busy||conflict;
    schedule.control.disabled=plannedSchedule?busy||conflict:scheduled.disabled;
    onDirty(dirty()||scheduleDirty()||busy||conflict);
  }
  text.control.addEventListener('input',update);schedule.control.addEventListener('input',update);
  async function saveNotice(wantsSubmit=false){
    if(busy||!text.control.reportValidity()||wantsSubmit&&!readiness.positionsReady)return;
    const time=schedule.control.value,publishAt=time?(time.length===16?time+':00':time)+'+08:00':'';
    if(plannedSchedule&&time){
      const deadline=(config.positionDraft||config.positionPlan)?.deadline||config.window?.start;
      schedule.control.setCustomValidity(!Number.isFinite(Date.parse(publishAt))||Date.parse(publishAt)<=Date.now()?'请选择未来的计划时间':deadline&&Date.parse(publishAt)>=Date.parse(deadline)?'计划开放须早于报名截止及活动开始':'');
      if(!schedule.control.reportValidity())return;
    }
    busy=true;update();
    try{
      if(dirty()||scheduleDirty())await mutate('/events/'+event._id+'/notice',{text:text.control.value,...(plannedSchedule?{publishAt}:{})},'PATCH',()=>{baseline=text.control.value;if(plannedSchedule)config.publishAt=publishAt;needsApproval=true;busy=false;});
      if(wantsSubmit)await mutate('/events/'+event._id+'/submit',{},'POST',()=>{busy=false;});
    }catch(error){reportError(error,wantsSubmit?'通知已保留，请核对审批提交结果':'通知未保存，输入已保留');}
    finally{busy=false;update();}
  }
  if(editable&&!controlsOnly){
    save=button({label:'保存通知',variant:'secondary',onClick:()=>saveNotice()});
    if(event['状态']==='草稿'){
      submit=button({label:'保存通知并提交审批',variant:'primary',onClick:()=>saveNotice(true)});
      actions.append(submit);
    }
    actions.append(save,button({label:'恢复预设模板',onClick:async()=>{
      if(!await confirmAction({title:'恢复预设模板？',description:'当前正文将被活动配置生成的模板替换。恢复后仍需点击保存通知。',confirmLabel:'恢复模板'}))return;
      text.control.value=noticeTemplate(config);update();
    }}));
  }
  actions.append(button({label:'复制当前正文',onClick:async()=>{try{await navigator.clipboard.writeText(text.control.value);notify.success('已复制当前正文');}catch(error){reportError(error,'复制失败');}}}));
  const body=h('div',{class:'stack-5'},workspace,h('div',{class:'notification-workspace'},
    h('section',{class:'notification-editor stack-4'},h('div',{class:'row-between'},h('h3',{text:'编辑报名公告'}),count),text,state,actions),
    h('aside',{class:'notification-preview stack-4','aria-label':'报名通知实时预览'},h('h3',{text:'报名页预览'}),preview,h('p',{class:'t-caption',text:'保存草稿 → 编辑并保存通知 → 提交审批 → 审批通过 → 立即发布或定时发布'}))));
  if(readiness.scheduled)workspace.append(h('p',{class:'t-caption',text:'需要修改活动或通知时，先取消定时发布。已有参与记录与已生成岗位仍受保护，不会因取消定时而允许改写。'}));
  if(controlsOnly)workspace.append(button({label:'复制报名通知',onClick:async()=>{try{await navigator.clipboard.writeText(baseline);notify.success('已复制报名通知');}catch(error){reportError(error,'复制失败');}}}));
  const node=controlsOnly?workspace:panel({title:'报名通知工作区',description:editable?'先完善通知，再提交审批。修改已批准正文后需要重新审批。':'查看通知与发布安排。',body});
  node.classList.add('notification-panel');
  node.isSaving=()=>busy;
  node.hasUnsaved=()=>dirty()||scheduleDirty()||busy;
  node.dispose=()=>schedule.disposeDateTimePicker?.();
  node.reconcile=next=>{if(next['申请版本']!==event['申请版本']||next['状态']!==event['状态']||next['通知草稿']!==event['通知草稿']||next['报名页配置']!==event['报名页配置']){conflict=true;update();}};
  update();return node;
}
