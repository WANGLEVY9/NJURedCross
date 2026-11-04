import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,notice,definitionList,field} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';

export async function openHoursSync(){
 const path='/api/volunteer/workflow/hours-sync',body=h('div',{class:'stack-4'},notice('正在读取同步状态…',{tone:'info'}));let busy=false,disposed=false;
 const format=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
 async function review(row,kind){
  const endpoint=`${path}/${kind}`,{result:s}=await request(`${endpoint}?key=${encodeURIComponent(row.key)}`,{fresh:true});
  const year=kind==='year-base',reason=field({label:'核对原因',multiline:true,required:true,maxlength:500});
  const amount=year?field({label:'原学年值中已包含的本站服务时长',type:'number',min:0,max:Math.min(s.siteHours,s.yearHours),step:'any',required:true,value:'',hint:'填 0 表示原数值全是其他历史时长；填写已包含的本站部分，系统只补差额。'}):s.previousCreditedHours===null?field({label:'原实际入账志愿时长',type:'number',min:0,max:100000,step:'any',required:true,hint:'旧回执无法确定原入账口径，请核对原表后填写。'}):null;
  const facts=year?[['当前26–27学年时长',`${s.yearHours} 小时`],['本站已入账服务时长',`${s.siteHours} 小时`]]:[['原服务时长',`${s.before.serviceHours} 小时`],['底表新服务时长',`${s.after.serviceHours} 小时`],['培训／交通（原→新）',`${s.before.trainingHours}／${s.before.travelHours} → ${s.after.trainingHours}／${s.after.travelHours}`],['原实际入账时长',s.previousCreditedHours===null?'需核对':`${s.previousCreditedHours} 小时`],['汇总修订差额',s.delta===null?'按核对值计算':`${s.delta>0?'+':''}${s.delta} 小时`]];
  await new Promise(resolve=>{
   let saving=false;const check=h('input',{type:'checkbox','aria-label':'已核对原表和本次修订'}),feedback=h('div',{role:'status'});
   const submit=button({label:'确认并同步',variant:'primary',onClick:async()=>{
    if(saving||!reason.control.reportValidity()||amount&&!amount.control.reportValidity())return;
    if(!check.checked){feedback.replaceChildren(notice('请先勾选已核对原表和本次修订',{tone:'warning'}));return;}
    saving=true;submit.disabled=true;
    try{await request(endpoint,{method:'POST',body:{key:row.key,token:s.token,confirmed:true,reason:reason.control.value,...(amount?{[year?'includedHours':'previousCreditedHours']:amount.control.value}:{})}});saving=false;await dialog.close();}
    catch(error){reportError(error,'核对结果未提交，请保留内容并重新检查');}
    finally{saving=false;submit.disabled=false;}
   }});
   const dialog=openModal({title:year?'核对学年历史基数':'核对底表时长修订',width:900,body:h('div',{class:'stack-4'},definitionList([['人员',`${s.name} · ${s.studentId}`],...facts]),notice(year?'确认后同步该同学当前已入账服务时长，保留原学年列中的其他历史部分。':'确认后按服务时长差额修订两张汇总表及学年值；历史审批和本次修订均留存记录。归档表修改后请重新下载。',{tone:'info'}),...(year?s.records.map(record=>h('p',{class:'t-caption',text:`${record.name} · ${record.dates||'日期待核对'} · 服务 ${record.serviceHours} 小时`})):[]),amount,reason,h('label',{},check,' 已核对原表和本次修订'),feedback),footer:[button({label:'取消',onClick:()=>dialog.close()}),submit],onClose:resolve});
   dialog.setCloseGuard(()=>!saving);
  });
 }
 async function load(){const {result}=await request(path,{fresh:true});if(disposed)return;body.replaceChildren(h('p',{text:'个人主页支持超管手动同步，也会在每周一北京时间 06:00 自动更新。终审通过后写入两张汇总表，志愿时长只计服务部分。'}),definitionList([...(result.nextProfileSyncAt?[['下次自动同步',format(result.nextProfileSyncAt)]]:[]),...(result.lastRun?.at?[['最近核对',format(result.lastRun.at)]]:[])]));
  if(result.unavailable){body.append(notice('时长同步尚未配置',{tone:'warning'}));return;}
  if(result.lastRun?.inProgress)body.append(notice('同步正在后台进行，请稍后刷新状态。',{tone:'info'}));
  const receipts=result.receipts||[],done=receipts.filter(r=>r.profileStatus==='done').length;
  const revisionKeys=new Set((result.lastRun?.failures||[]).filter(f=>f.step==='revision').map(f=>f.key));
  const acceptedKeys=new Set((result.pendingRevisions||[]).map(row=>row.key));
  if(receipts.length)body.append(h('p',{class:'t-caption',text:`共 ${receipts.length} 条核定记录 · 已同步个人主页 ${done} 条`}));
  else body.append(h('p',{class:'t-caption',text:'暂无核定时长记录。终审归档后将在这里显示同步进度。'}));
  for(const failure of result.lastRun?.failures||[])body.append(notice(failure.message,{tone:'warning'}));
  for(const row of receipts.filter(r=>r.legacyStatus!=='done'||r.websiteStatus!=='done'||r.profileStatus!=='done'||revisionKeys.has(r.key)||acceptedKeys.has(r.key))){
   const status=acceptedKeys.has(row.key)?'超管已确认修订 · 同步中':revisionKeys.has(row.key)?'底表修订待超管核对':row.legacyStatus==='done'&&row.websiteStatus==='done'?'已入汇总表 · 待同步个人主页':'汇总表待核对';
   const node=h('div',{class:'stack-2'},h('strong',{text:`${row.source.name} · ${row.source.studentId} · ${row.source.activityName}`}),h('p',{class:'t-caption',text:`服务 ${row.source.serviceHours} 小时 · ${status}`}),row.error?h('p',{class:'t-caption',text:row.error}):null);
   if(revisionKeys.has(row.key)&&!acceptedKeys.has(row.key))node.append(button({label:'核对底表修订',size:'sm',onClick:()=>act(()=>review(row,'revision'))}));
   if(row.profileStatus==='failed')node.append(button({label:'核对学年基数',size:'sm',onClick:()=>act(()=>review(row,'year-base'))}));
   if(row.legacyStatus==='failed')node.append(button({label:'核对原表已入账',size:'sm',onClick:()=>act(async()=>{
    const {result:snapshot}=await request(`${path}/acknowledge?key=${encodeURIComponent(row.key)}`,{fresh:true});
    if(!await confirmAction({title:'确认原表已包含这些时长？',description:`${snapshot.name}（${snapshot.studentId}）在“${snapshot.activityName}”共 ${snapshot.count} 条、服务合计 ${snapshot.totalHours} 小时。原汇总表累计 ${snapshot.legacyHours} 小时。请先核对原记录；确认后只补记入账回执，不增加原表时长。`,confirmLabel:'已核对，原表已入账'}))return;
    await request(`${path}/acknowledge`,{method:'POST',body:{key:row.key,token:snapshot.token,confirmed:true}});
    await request(path,{method:'POST',body:{}});
   })}));body.append(node);
  }
  if(result.revisions?.length)body.append(h('details',{},h('summary',{text:`已确认修订记录 ${result.revisions.length} 条`}),...result.revisions.map(item=>h('p',{class:'t-caption',text:`${item.after.name} · ${item.after.activityName} · 服务 ${item.before.serviceHours} → ${item.after.serviceHours} 小时 · ${format(item.confirmedAt)} · ${item.actor} · ${item.reason}`}))));
 }
 async function act(task){if(busy)return;busy=true;retry.disabled=sync.disabled=true;try{await task();await load();}catch(error){reportError(error,'同步结果请刷新核对');}finally{busy=false;retry.disabled=sync.disabled=false;}}
 const refresh=button({label:'刷新状态',onClick:()=>act(async()=>{})});
 const retry=button({label:'重试汇总与到期同步',onClick:()=>act(()=>request(path,{method:'POST',body:{}}))});
 const sync=button({label:'立即同步个人主页',variant:'primary',onClick:async()=>{if(await confirmAction({title:'立即同步个人主页？',description:'将当前已成功写入两张汇总表的核定时长同步到个人主页，无需等待下周一。历史学年时长和总时长公式保持不变。',confirmLabel:'立即同步'}))await act(()=>request(path,{method:'POST',body:{profiles:true}}));}});
 const dialog=openModal({title:'时长入账与同步',width:1000,body,footer:[button({label:'关闭',onClick:()=>dialog.close()}),refresh,retry,sync],onClose:()=>{disposed=true;}});dialog.surface.classList.add('hours-sync-modal');dialog.setCloseGuard(()=>!busy);
 try{await load();}catch(error){body.replaceChildren(notice('同步状态读取失败，请点击刷新状态重试。',{tone:'warning'}));reportError(error,'同步状态暂时无法读取');}
}
