import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,notice,definitionList} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';

export async function openHoursSync(){
 const path='/api/volunteer/workflow/hours-sync',body=h('div',{class:'stack-4'});let busy=false,disposed=false;
 const format=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
 async function load(){const {result}=await request(path,{fresh:true});if(disposed)return;body.replaceChildren(notice('终审通过后写入两张汇总表；个人主页每周一北京时间 06:00 更新。服务、培训、交通时长合计入账。',{tone:'info'}),definitionList([['下次个人主页同步',format(result.nextProfileSyncAt)],['最近核对',format(result.lastRun?.at)]]));
  if(result.unavailable){body.append(notice('时长同步尚未配置',{tone:'warning'}));return;}
  if(result.lastRun?.inProgress)body.append(notice('同步正在后台进行，请稍后刷新状态。',{tone:'info'}));
  const receipts=result.receipts||[],done=receipts.filter(r=>r.profileStatus==='done').length;
  body.append(h('p',{class:'t-caption',text:`共 ${receipts.length} 条核定记录 · 已同步个人主页 ${done} 条`}));
  for(const failure of result.lastRun?.failures||[])body.append(notice(failure.message,{tone:'warning'}));
  for(const row of receipts.filter(r=>r.legacyStatus!=='done'||r.websiteStatus!=='done'||r.profileStatus!=='done')){
   const status=row.legacyStatus==='done'&&row.websiteStatus==='done'?'已入汇总表 · 待同步个人主页':'汇总表待核对';
   const node=h('div',{class:'stack-2'},h('strong',{text:`${row.source.name} · ${row.source.studentId} · ${row.source.activityName}`}),h('p',{class:'t-caption',text:`${row.source.totalHours} 小时 · ${status}`}),row.error?h('p',{class:'t-caption',text:row.error}):null);
   if(row.legacyStatus==='failed')node.append(button({label:'核对原表已入账',size:'sm',onClick:()=>act(async()=>{
    const {result:snapshot}=await request(`${path}/acknowledge?key=${encodeURIComponent(row.key)}`,{fresh:true});
    if(!await confirmAction({title:'确认原表已包含这些时长？',description:`${snapshot.name}（${snapshot.studentId}）在“${snapshot.activityName}”共 ${snapshot.count} 条、合计 ${snapshot.totalHours} 小时。原汇总表累计 ${snapshot.legacyHours} 小时。请先核对原记录；确认后只补记入账回执，不增加原表时长。`,confirmLabel:'已核对，原表已入账'}))return;
    await request(`${path}/acknowledge`,{method:'POST',body:{key:row.key,token:snapshot.token,confirmed:true}});
    await request(path,{method:'POST',body:{}});
   })}));body.append(node);
  }
 }
 async function act(task){if(busy)return;busy=true;retry.disabled=sync.disabled=true;try{await task();await load();}catch(error){reportError(error,'同步结果请刷新核对');}finally{busy=false;retry.disabled=sync.disabled=false;}}
 const refresh=button({label:'刷新状态',onClick:()=>act(async()=>{})});
 const retry=button({label:'重试汇总与到期同步',onClick:()=>act(()=>request(path,{method:'POST',body:{}}))});
 const sync=button({label:'立即同步个人主页',variant:'primary',onClick:async()=>{if(await confirmAction({title:'立即同步个人主页？',description:'将当前已成功写入两张汇总表的核定时长同步到个人主页，无需等待下周一。历史学年时长和总时长公式保持不变。',confirmLabel:'立即同步'}))await act(()=>request(path,{method:'POST',body:{profiles:true}}));}});
 const dialog=openModal({title:'时长入账与同步',width:1000,body,footer:[button({label:'关闭',onClick:()=>dialog.close()}),refresh,retry,sync],onClose:()=>{disposed=true;}});dialog.setCloseGuard(()=>!busy);
 try{await load();}catch(error){reportError(error,'同步状态暂时无法读取');}
}
