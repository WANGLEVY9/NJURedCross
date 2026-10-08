import {ACTIVITY_CENTERS,HALF_HOURS,serviceDuration,matchesActivity} from '../../shared/activity-management.js';
import {rosterPanel,publicationPanel} from './activity-management.js';
import {localizeActivityDate} from './activity-date.js';
import {h,clear,icon} from '../../core/dom.js';
import {request,getSessionState,refreshSession,ApiError} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {asyncRegion} from '../lib.js';
import {pageHead,panel,field,button,badge,segmented,emptyState,notice,definitionList,runWithLoading,checkbox} from '../../ui/primitives.js';
const root='/api/volunteer/workflow';
const config=e=>{try{return JSON.parse(e['报名页配置']||'{}');}catch{return {};}};
const result=r=>r['报名状态']==='待筛选'?'待确认':r['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(r['报名状态'])?'报名成功':r['报名状态'];
export default async function activityCenter(context,shell){
 let superAdmin=getSessionState().user?.role==='super_admin';
 let actor=getSessionState().user?.accountId||getSessionState().user?.username;
 let data={events:[],registrations:[],ledger:[],sources:[]},selected=context.query.get('event')||'',mode='open',tab='overview',search='',category='';
 let directory={administrators:[],participants:[]},directoryError=false;
 async function loadDirectory(){try{directory=await request(root+'/directory');directoryError=Boolean(directory.profileWarning);}catch{directoryError=true;}}
 const countdownTimer=setInterval(()=>{for(const node of detail.querySelectorAll('[data-publish-countdown]')){const value=node.dataset.publishCountdown;if(!value){node.textContent='';continue;}const left=Math.ceil((Date.parse(value)-Date.now())/1000);node.textContent=left>0?`报名开始：${value.slice(0,16).replace('T',' ')}（北京时间） · 距开始 ${Math.floor(left/86400)} 天 ${Math.floor(left%86400/3600)} 时 ${Math.floor(left%3600/60)} 分 ${left%60} 秒`:'已到报名开始时间；启动发布后可报名。';}},1000);
 const workspace=h('div',{class:'activity-workspace'}),list=h('div',{class:'activity-list'}),detail=h('div',{class:'activity-detail'}),summary=h('div',{class:'activity-summary'});let view,refreshSequence=0,sourceSequence=0;
 function updatePayload(payload){
  let scroller=view.parentElement;
  while(scroller&&!['auto','scroll'].includes(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement;
  scroller ||= document.scrollingElement;
  const top=scroller.scrollTop,left=scroller.scrollLeft,previousMinHeight=view.style.minHeight,previousAnchor=view.style.overflowAnchor;
  const viewportBottom=scroller===document.scrollingElement?window.innerHeight:scroller.getBoundingClientRect().bottom;
  // Reserve space while replacing the connected activity region so scroll cannot clamp.
  view.style.minHeight=`${Math.max(view.getBoundingClientRect().height,viewportBottom-view.getBoundingClientRect().top)}px`;
  view.style.overflowAnchor='none';
  try{
   const output=renderPayload(payload);view.replaceChildren(...output.filter(Boolean));
   scroller.scrollTo({top,left,behavior:'instant'});
   const records=detail.querySelector('.activity-roster-records');
   if(records)records.style.minHeight=`${Math.max(0,viewportBottom-records.getBoundingClientRect().top)}px`;
  }finally{
   view.style.minHeight=previousMinHeight;
   scroller.scrollTo({top,left,behavior:'instant'});
   view.style.overflowAnchor=previousAnchor;
  }
 }
 async function reload(full=false){
  const sequence=++refreshSequence;
  view.setAttribute('aria-busy','true');
  try{
   const payload=full?await loadAll():{...data,...await request(root)};
   if(sequence!==refreshSequence)return;
   updatePayload(payload);
   if(full)shell?.refreshTodos?.();
  }catch(error){if(error.status===401&&sequence===refreshSequence){clear(view);view.append(notice('登录已失效，请重新登录。',{tone:'warning'}));}throw error;}finally{if(sequence===refreshSequence)view.removeAttribute('aria-busy');}
 }
 async function refreshAfterWrite(){
  try{await reload();return true;}catch(error){notify.warning('操作已保存，记录刷新失败','请点击刷新重新获取记录，无需重复提交。');if(error.status===401)reportError(error,'登录已失效');return false;}
 }
 async function mutate(path,body={},method='POST'){await request(root+path,{method,body});if(await refreshAfterWrite())notify.success('已完成');}
 function action(label,path,body={},primary=false){let b;b=button({label,variant:primary?'primary':'secondary',size:'sm',onClick:async()=>{try{await runWithLoading(b,()=>mutate(path,body));}catch(error){reportError(error,'操作未完成');}}});return b;}
 function reasonAction(label,path){const reason=field({label:'处理说明',required:true,multiline:true,rows:3,maxlength:500});let drawer,b;b=button({label:'确认处理',variant:'primary',onClick:async()=>{if(!reason.control.reportValidity())return;try{await runWithLoading(b,()=>mutate(path,{reason:reason.control.value}));drawer.close();}catch(error){reportError(error,'处理未完成');}}});drawer=openDrawer({title:label,description:'处理说明将显示在参与者的报名记录中。',body:[reason],footer:[b]});}
 function createDrawer({event=null,source=null,copy=null}={}){
  const basis=event||copy,old=basis?config(basis):{},chosen=old.blood?'blood_vehicle':old.templateId||'general',fields=[];
  const coOwners=new Set(old.coOwners||[]);
  const seed=basis?{...old,name:basis['活动名称'],category:basis['活动类别'],date:basis['报名日期'],slot:basis['报名时段'],position:basis['岗位'],capacity:basis['容量'],serviceHours:basis['服务时长'],trainingHours:basis['培训时长'],travelHours:basis['交通时长'],location:basis['地点'],work:basis['工作内容'],week:old.blood?.week}:source||{};
  const body=h('div',{class:'activity-create-form stack-5'});let drawer;
  function f(name,label,type='text',extra={}){
   const node=field({name,label,type,required:true,value:seed[name]??(['trainingHours','travelHours'].includes(name)?1:''),...extra});
   node.control.required=extra.required!==false;fields.push(node);return node;
  }
  const region=f('region','活动类型','text',{value:seed.region||'南京活动',options:['南京活动','苏州活动']});
  const name=f('name','活动名称','text',{placeholder:'例如：5.31 探索人道法',hint:'建议格式：日期＋活动名称',maxlength:500});
  const activityCategory=f('category','活动类别','text',{value:seed.category||'',maxlength:500});
  const primary=event?event['负责人账号ID']:actor;
  const ownerName=event?directory.administrators.find(a=>a.id===primary)?.name||primary:getSessionState().user?.label||actor;
  const owners=h('section',{class:'activity-owner-fields stack-3'},h('h3',{class:'field__label',text:'负责人'}),h('div',{class:'activity-primary-owner'},h('span',{class:'t-caption',text:'第一负责人'}),h('strong',{text:ownerName})),h('p',{class:'t-caption',text:'补充负责人（可多选）'}),...directory.administrators.filter(a=>a.id!==primary).map(a=>checkbox({label:a.name,checked:coOwners.has(a.id),onChange:checked=>{if(checked)coOwners.add(a.id);else coOwners.delete(a.id);}})),directoryError?notice('管理员列表未加载，请刷新后选择补充负责人。',{tone:'warning'}):null);
  const information=panel({title:'活动信息',body:h('div',{class:'stack-4'},name,activityCategory,owners)});
  const date=localizeActivityDate(f('date','活动日期','date'));
  const dates=field({label:'从源表选择日期',options:[{value:'',label:'手动选择日期'},...[...new Set(data.sources.map(s=>s.date).filter(Boolean))].sort()],onInput:()=>{if(dates.control.value){date.control.value=dates.control.value;date.refreshDate();}}});
  const oldTimes=String(seed.slot||'').match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  const startTime=seed.startTime||old.blood?.start?.slice(11,16)||oldTimes?.[1]||'';
  const endTime=seed.endTime||old.blood?.end?.slice(11,16)||oldTimes?.[2]||'';
  const timeOptions=[{value:'',label:'请选择'},...HALF_HOURS];
  const start=f('startTime','开始时间','text',{value:startTime,options:timeOptions,disabled:Boolean(old.blood)});
  const end=f('endTime','结束时间','text',{value:endTime,options:timeOptions,disabled:Boolean(old.blood)});
  const durationHint=h('p',{class:'field__hint',text:'选择开始与结束时间，支持整点、半点。','aria-live':'polite'});
  const period=h('fieldset',{class:'activity-time-field'},h('legend',{class:'field__label',text:'时段'}),h('div',{class:'activity-time-range'},start,h('span',{class:'activity-time-divider',text:'至','aria-hidden':'true'}),end),durationHint);
  const location=f('location','活动地点','text',{placeholder:'请输入活动地点',hint:'填写示例：校内：仙林校区……；校外：南京市……',maxlength:500});
  location.classList.add('activity-location-field');
  const position=f('position','报名岗位（选填）','text',{required:false,maxlength:500});
  const capacity=f('capacity','推荐录取名额','number',{min:1,step:1,value:seed.capacity||20});
  const limit=f('registrationLimit','上限名额','number',{min:1,step:1,value:seed.registrationLimit||seed.capacity||30});
  const content=f('content','活动内容','text',{value:seed.content||seed.work||'',multiline:true,rows:3,maxlength:500});
  const arrangements=panel({title:'活动安排',body:h('div',{class:'stack-4'},h('div',{class:'activity-formgrid'},date,dates),period,location,position,h('div',{class:'activity-formgrid'},capacity,limit),content)});
  const training=f('trainingHours','培训时长（小时）','number',{min:0,step:'any'});
  const travel=f('travelHours','交通时长（小时）','number',{min:0,step:'any'});
  const service=f('serviceHours','服务时长（小时）','number',{min:0.01,step:'any',hint:'根据活动时段自动计算。'});service.control.readOnly=true;
  const work=f('work','工作内容','text',{multiline:true,rows:3,maxlength:500});
  const hours=panel({title:'时长分配',body:h('div',{class:'stack-4'},h('div',{class:'activity-hours-grid'},training,travel,service),work)});
  function updateDuration(){
   const duration=serviceDuration(start.control.value,end.control.value);
   end.control.setCustomValidity(start.control.value&&end.control.value&&!duration?'请选择整点或半点，且结束时间须晚于开始时间':'');
   service.control.value=duration??'';
   durationHint.textContent=duration?'共 '+duration+' 小时，已同步至服务时长。':'选择开始与结束时间，支持整点、半点。';
  }
  for(const node of [start,end])node.control.addEventListener('change',updateDuration);
  if(startTime&&endTime)updateDuration();else service.control.value='';
  body.append(region,information,arrangements,hours);
  async function save(submit,control){if(fields.some(f=>!f.control.reportValidity()))return;const payload=Object.fromEntries(fields.map(f=>[f.control.name,f.control.value]));payload.slot=chosen==='blood_vehicle'?seed.slot:payload.startTime+'-'+payload.endTime;if(chosen==='blood_vehicle'){payload.week=seed.week;delete payload.startTime;delete payload.endTime;}payload.center=old.center;payload.team=old.team;payload.templateId=chosen;payload.submit=submit;payload.coOwners=[...coOwners];payload.benefits=old.benefits;payload.requirements=old.requirements;payload.publishAt=old.publishAt;let savedRows=[];try{await runWithLoading(control,async()=>{
    if(event){await request(`${root}/events/${event._id}`,{method:'PATCH',body:payload});if(submit)await request(`${root}/events/${event._id}/submit`,{method:'POST',body:{}});selected=event._id;}
    else if(source){const response=await request(`${root}/adopt`,{method:'POST',body:{key:source.key,config:payload}});selected=response.result._id;savedRows=[response.result];if(submit&&response.result['状态']==='草稿')await request(`${root}/events/${selected}/submit`,{method:'POST',body:{}});}
    else{const response=await request(`${root}/events`,{method:'POST',body:payload});selected=response.result._id;savedRows=[response.result];}
   });drawer.close();tab='overview';mode='all';search='';category='';searchInput.value='';categoryControl.setValue('');modeControl.setValue(mode);if(savedRows.length){const byId=new Map(data.events.map(row=>[row._id,row]));for(const row of savedRows)byId.set(row._id,row);const output=renderPayload({...data,events:[...byId.values()]});clear(view);for(const node of output)if(node)view.append(node);}
   notify.success(submit?'已提交审批':'草稿已保存');void refreshAfterWrite();}catch(error){reportError(error,'保存未完成');}}
  let draft,submit;draft=button({label:'保存草稿',variant:'secondary',onClick:()=>save(false,draft)});submit=button({label:'提交审批',variant:'primary',onClick:()=>save(true,submit)});
  drawer=openDrawer({title:event?'编辑活动':source?'完善源表活动':'新建活动',eyebrow:'活动中心',width:680,body,footer:[draft,submit]});
 }
 async function archive(e){const yes=await confirmAction({title:'将活动移到回收站？',description:'可从回收站恢复。已有参与记录的活动不能删除，请使用结束活动。',confirmLabel:'移到回收站'});if(yes)try{await mutate(`/events/${e._id}/archive`);}catch(error){reportError(error,'删除未完成');}}
 function showRecords(e,kind,viewState){if(kind==='roster')return rosterPanel(e,data.registrations.filter(r=>r['活动ID']===e['活动ID']),{refresh:refreshAfterWrite,directory:directory.participants,directoryError,viewState});const regs=data.registrations.filter(r=>r['活动ID']===e['活动ID']);const hours=data.ledger.filter(r=>r['活动ID']===e['活动ID']);
  if(kind==='hours')return panel({title:'志愿时长核对与入账',actions:[button({label:'时长录入表预览',size:'sm',onClick:async()=>{try{const draft=await request(`${root}/events/${e._id}/export-preview`);openDrawer({title:'时长录入表预览',body:[...draft.warnings.map(t=>notice(t,{tone:'warning'})),...draft.rows.map(r=>definitionList(Object.entries(r)))]});}catch(error){reportError(error,'暂不可导出');}}})],description:'查看并确认参与者的志愿时长。',body:hours.length?h('div',{class:'activity-records'},...hours.map(l=>h('article',{class:'activity-person'},h('div',{class:'row-between row-wrap'},h('strong',{text:l['姓名']}),badge(l['状态'],{tone:l['状态']==='已入账'?'success':'warning'})),h('p',{class:'t-caption',text:`学号 ${l['学号']} · 服务 ${l['服务时长']} / 培训 ${l['培训时长']} / 交通 ${l['交通时长']} 小时`}),h('div',{class:'row-2 row-wrap'},l['状态']==='待批准'?!superAdmin&&(l['核对人']===actor||l['账号ID']===actor)?badge('待审批'):action('批准时长',`/hours/${l._id}/approve`,{},true):l['状态']==='已批准'?action('确认入账',`/hours/${l._id}/post`,{},true):action('重新对账',`/hours/${l._id}/post`))))):emptyState({title:'暂无待确认时长',description:'完成签到后，在签到页录入时长。'})});
  return panel({title:kind==='roster'?'报名与请假':'现场签到核验',description:kind==='roster'?'确认名单后，参与者看到报名成功。请假批准后释放名额。':'查看签到照片，确认参与者已到场。',body:regs.length?h('div',{class:'activity-records'},...regs.map(r=>h('article',{class:'activity-person'},h('div',{class:'row-between row-wrap'},h('strong',{text:r['姓名']}),badge(kind==='checkins'?r['报名状态']==='已签到'?'已核验':r['签到照片ID']?'待核验':'未提交签到':result(r),{tone:['已确认','已签到'].includes(r['报名状态'])?'success':'warning'})),h('p',{class:'t-caption',text:`${r['学号']} · ${r['岗位']} · ${r['报名类型']||'普通报名'}`}),r['处理说明']?h('p',{class:'t-caption',text:r['处理说明']}):null,
   kind==='roster'?h('div',{class:'row-2 row-wrap'},r['报名状态']==='待筛选'&&r['请假状态']!=='待审批'?action('确认报名成功',`/registrations/${r._id}/confirm`,{},true):null,r['报名状态']==='待筛选'&&r['请假状态']!=='待审批'?button({label:'报名失败',size:'sm',onClick:()=>reasonAction('标记报名失败',`/registrations/${r._id}/reject`)}):null,r['请假状态']==='待审批'?h('div',{class:'stack-3'},notice(`请假：${r['请假原因']}`,{tone:'warning'}),h('div',{class:'row-2 row-wrap'},button({label:'批准请假',size:'sm',onClick:()=>reasonAction('批准请假',`/registrations/${r._id}/leave-approve`)}),button({label:'驳回请假',size:'sm',onClick:()=>reasonAction('驳回请假',`/registrations/${r._id}/leave-reject`)}))):r['请假状态']?badge(`请假${r['请假状态']}`):null):h('div',{class:'row-2 row-wrap'},r['签到照片ID']?button({label:'查看现场照片',href:`${root}/registrations/${r._id}/photo`,data:{native:true},size:'sm'}):null,e['状态']==='报名中'&&r['报名状态']==='已确认'&&r['请假状态']!=='待审批'?button({label:'核验签到',size:'sm',onClick:()=>{const note=field({label:'签到备注',required:true,multiline:true,rows:3});let drawer;drawer=openDrawer({title:`核验签到 · ${r['姓名']}`,body:[note],footer:[button({label:'确认已到场',variant:'primary',onClick:async()=>{if(!note.control.reportValidity())return;try{await mutate(`/registrations/${r._id}/checkin`,{note:note.control.value});drawer.close();}catch(error){reportError(error,'核验未完成');}}})]});}}):null,r['报名状态']==='已签到'?action(hours.some(l=>l['报名行ID']===r._id)?'复核时长':'录入时长',`/registrations/${r._id}/review`,{},!hours.some(l=>l['报名行ID']===r._id)):null)))):emptyState({title:'暂无报名记录',description:'审批并发布活动后，报名记录会显示在这里。'})});
 }
 function renderDetail(){const viewState=detail.querySelector('.activity-roster')?.getViewState?.();clear(detail);const e=data.events.find(e=>e._id===selected||e['活动ID']===selected),source=data.sources.find(s=>s.key===selected);
  if(!e){detail.append(source?panel({title:source.name,description:'请补全活动信息。',body:h('div',{class:'stack-4'},badge('待配置',{tone:'warning'}),definitionList([['来源表',source.table],['日期',source.date||'待填写'],['时段 / 岗位',[source.slot,source.position].filter(Boolean).join(' · ')||'待填写']]),notice('补全活动信息后提交审批。',{tone:'neutral'}),button({label:'完善配置并纳入流程',variant:'primary',onClick:()=>createDrawer({source})}))}):emptyState({title:'选择活动开始管理',description:'新建活动或选择待配置的源表活动。'}));return;}
  const regs=data.registrations.filter(r=>r['活动ID']===e['活动ID']),hours=data.ledger.filter(l=>l['活动ID']===e['活动ID']);const editable=!['报名中','已结束','停点','已归档'].includes(e['状态'])&&!regs.length;
  const stage=['草稿','待配置','待审核'].includes(e['状态'])?0:e['状态']==='可发布'?1:hours.some(l=>l['状态']==='已入账')?4:regs.some(r=>r['报名状态']==='已签到')?3:2;
  const next=e['状态']==='草稿'?action('提交审批',`/events/${e._id}/submit`,{},true):e['状态']==='待审核'&&(superAdmin||e['负责人账号ID']!==actor&&config(e).lastEditor!==actor)?action('审批通过',`/events/${e._id}/approve`,{},true):null;
  const mainActions=h('div',{class:'activity-detail-main-actions'},
   tab==='overview'?next:null,
   editable?button({label:'编辑配置',variant:tab==='overview'&&next?'secondary':'primary',iconName:'edit',onClick:()=>createDrawer({event:e})}):null,
   e['状态']==='报名中'?button({label:'查看报名页面',variant:'primary',href:`/workflow-events?event=${encodeURIComponent(e._id)}`}):null,
   button({label:'复制为新活动',iconName:'copy',onClick:()=>createDrawer({copy:e})}),
   ['报名中','停点'].includes(e['状态'])?button({label:'结束活动',variant:'secondary',onClick:async()=>{const yes=await confirmAction({title:'结束该活动？',description:'结束后关闭新报名与签到，已有签到和时长记录保留。',confirmLabel:'结束活动'});if(yes)try{await mutate(`/events/${e._id}/close`);}catch(error){reportError(error,'结束未完成');}}}):null);
  const secondaryActions=h('div',{class:'activity-detail-secondary-actions'},
   e['状态']==='已归档'?action('恢复活动',`/events/${e._id}/restore`):!regs.length?button({label:'删除活动',variant:'ghost',iconName:'trash',onClick:()=>archive(e)}):null,
   config(e).blood&&e['状态']==='报名中'?button({label:'停点',variant:'ghost',onClick:()=>reasonAction('停点并显示原因',`/events/${e._id}/stop`)}):null);
  const header=h('header',{class:'activity-detail-head'},
   h('div',{class:'activity-detail-heading'},h('div',{class:'activity-detail-identity'},h('h2',{class:'activity-detail-title',text:e['活动名称']}),h('p',{class:'activity-detail-category',text:'活动类别 · '+(e['活动类别']||'未分类')})),badge(e['状态']==='待审核'?'待审批':e['状态'],{tone:e['状态']==='报名中'?'success':e['状态']==='待审核'?'warning':'neutral'})),
   h('dl',{class:'activity-detail-facts'},...[['calendar','活动日期',e['报名日期']],['clock','活动时段',e['报名时段']],['pin','活动地点',e['地点']]].map(([symbol,label,value])=>h('div',{},h('dt',{},icon(symbol,'ico ico--sm'),label),h('dd',{text:value||'待填写'})))),
   h('div',{class:'activity-detail-actions'},mainActions,secondaryActions));
  detail.append(header,...(e['报名日期']<new Date(Date.now()+8*3600000).toISOString().slice(0,10)?[notice('活动日期已过去。开展新一期活动时，请复制并修改日期。',{tone:'warning'})]:[]),h('ol',{class:'activity-stages','aria-label':'活动管理步骤'},...['申请审批','发布报名','名单确认','签到核验','时长入账'].map((text,i)=>h('li',{class:tab===['overview','publish','roster','checkins','hours'][i]?'is-current':i<stage?'is-done':''},h('button',{type:'button','aria-current':tab===['overview','publish','roster','checkins','hours'][i]?'step':null,on:{click:()=>{tab=['overview','publish','roster','checkins','hours'][i];renderDetail();}},text:(i+1)+' '+text})))));
  if(tab==='publish'){detail.append(publicationPanel(e,{config:config(e),mutate,editable}));return;}
  if(tab!=='overview'){detail.append(showRecords(e,tab,viewState));return;}
  detail.append(panel({title:'活动配置',body:definitionList([['岗位 / 名额',`${e['岗位']} · ${e['容量']} 人`],['服务时长',`${e['服务时长']} 小时`],['培训 / 交通',`${e['培训时长']} / ${e['交通时长']} 小时`],['工作内容',e['工作内容']],['参与情况',`${regs.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length} 人已确认 · ${regs.filter(r=>r['报名状态']==='已签到').length} 人已核验 · ${hours.filter(l=>l['状态']==='已入账').length} 笔已入账`],['审批记录',e['审批人']?`版本 ${e['批准版本']} · ${e['审批时间']}`:'尚未通过审批']])}));
 }
 function renderList(){clear(list);const adopted=new Set(data.events.map(e=>config(e).source?.key).filter(Boolean));const items=[...data.events.map(e=>({id:e._id,name:e['活动名称'],status:e['状态']||'待配置',date:e['报名日期'],category:e['活动类别'],center:config(e).center,team:config(e).team,region:config(e).region})),...data.sources.filter(s=>!adopted.has(s.key)).map(s=>({id:s.key,name:s.name,status:'待配置',date:s.date,category:s.category,source:s.table}))].filter(e=>matchesActivity(e,{mode,category,search}));
  if(!items.some(e=>e.id===selected)){selected=items[0]?.id||'';tab='overview';}
  if(!items.length)list.append(mode==='sources'&&data.sourcesLoading?notice('正在加载待配置活动…',{tone:'neutral'}):emptyState({title:'没有符合条件的活动',description:'调整筛选条件，或新建活动。'}));
  for(const e of items)list.append(h('button',{type:'button',class:'activity-list-item',aria:{pressed:String(e.id===selected)},on:{click:()=>{selected=e.id;tab=e.status==='可发布'?'publish':e.status==='报名中'?'roster':'overview';renderList();}}},h('div',{class:'row-between row-wrap'},badge(e.status,{tone:e.status==='报名中'?'success':'neutral'}),h('span',{class:'t-caption',text:e.date||'日期待定'})),h('strong',{text:e.name}),h('span',{class:'t-caption',text:[e.center,e.category,e.source].filter(Boolean).join(' · ')})));
  renderDetail();
 }
 const categoryControl=h('div',{class:'activity-category-filters',role:'group','aria-label':'活动分类'});categoryControl.setValue=value=>{for(const item of categoryControl.children)item.setAttribute('aria-pressed',String(item.dataset.category===value));};
 for(const value of ['',...ACTIVITY_CENTERS])categoryControl.append(h('button',{type:'button',data:{category:value},'aria-pressed':String(value===category),on:{click:()=>{category=value;categoryControl.setValue(value);renderList();}},text:value||'全部分类'}));

 const modeControl=segmented({items:[{value:'all',label:'全部'},{value:'review',label:'待审批'},{value:'open',label:'进行中'},{value:'sources',label:'待配置'},{value:'trash',label:'回收站'}],value:mode,ariaLabel:'活动状态筛选',onChange:value=>{mode=value;modeControl.setValue(value);renderList();}});
 modeControl.classList.add('activity-status-tabs');
 const searchInput=h('input',{class:'input',type:'search',placeholder:'搜索活动名称、类型或日期','aria-label':'搜索活动',on:{input:event=>{search=event.target.value;renderList();}}});
 function setListCollapsed(collapsed){
  workspace.dataset.listCollapsed=String(collapsed);master.hidden=collapsed;
  listRestore.hidden=!collapsed;
  listCollapseButton.setAttribute('aria-expanded',String(!collapsed));listExpandButton.setAttribute('aria-expanded',String(!collapsed));
  (collapsed?listExpandButton:listCollapseButton).focus({preventScroll:true});
 }
 const listCollapseButton=button({label:'收起',ariaLabel:'收起活动列表',iconName:'sidebar',size:'sm',onClick:()=>setListCollapsed(true)});
 const listExpandButton=button({label:'展开活动列表',iconName:'sidebar',onClick:()=>setListCollapsed(false)});
 for(const [control,expanded] of [[listCollapseButton,true],[listExpandButton,false]]){control.setAttribute('aria-expanded',String(expanded));control.setAttribute('aria-controls','activity-list-panel');}
 const listRestore=h('div',{class:'activity-list-restore',hidden:true},listExpandButton);
 const master=h('aside',{class:'activity-master',id:'activity-list-panel'},h('div',{class:'activity-list-tools stack-3'},
  h('div',{class:'activity-list-heading'},h('h2',{text:'活动列表'}),listCollapseButton),searchInput,
  h('div',{class:'activity-list-filter-group'},h('span',{class:'activity-list-filter-label',text:'活动状态'}),modeControl),
  h('div',{class:'activity-list-filter-group'},h('span',{class:'activity-list-filter-label',text:'活动分类'}),categoryControl)),list);
 const detailColumn=h('div',{class:'activity-detail-column'},listRestore,detail);
 async function loadSources(){
  const sequence=++sourceSequence;data={...data,sourcesLoading:true};
  try{
   const payload=await request(root+'/sources');
   if(sequence!==sourceSequence)return;
   data={...data,sources:payload.sources,sourceWarnings:payload.warnings||[],sourceError:false,sourcesLoading:false};
  }catch{if(sequence!==sourceSequence)return;data={...data,sourceError:true,sourcesLoading:false};}
  if(view?.dataset.ready==='true'){
   updatePayload(data);
  }
 }
 async function loadAll(){
  if(!getSessionState().authenticated)await refreshSession();
  const current=getSessionState();if(!current.authenticated)throw new ApiError('登录已失效，请重新登录。',{status:401});
  superAdmin=current.user.role==='super_admin';actor=current.user.accountId||current.user.username;
  // Existing managed activities do not wait for the much larger source catalogue.
  const sources=loadSources();
  const [payload]=await Promise.all([request(root),loadDirectory()]);
  void sources;
  return {...payload,sources:data.sources,sourceWarnings:data.sourceWarnings||[],sourceError:data.sourceError,sourcesLoading:data.sourcesLoading!==false};
 }

 function renderPayload(payload){view.dataset.ready='true';data=payload;clear(summary);const active=data.events.filter(e=>e['状态']!=='已归档'),adopted=new Set(data.events.map(e=>config(e).source?.key));summary.append(...[['活动项目',active.length],['待审批',active.filter(e=>['草稿','待审核'].includes(e['状态'])).length],['报名中',active.filter(e=>e['状态']==='报名中').length],['源表待配置',data.sourcesLoading?'…':data.sources.filter(s=>!adopted.has(s.key)).length]].map(([label,value])=>h('div',{},h('strong',{text:value}),h('span',{text:label}))));if(!selected)selected=active[0]?._id||data.sources[0]?.key||'';renderList();renderDetail();return [payload.sourceError?notice('源表活动暂未加载成功，现有网站活动仍可管理。请刷新重试。',{tone:'warning'}):null,...payload.sourceWarnings.map(text=>notice(text,{tone:'warning'})),summary,workspace];}
 view=asyncRegion({errorTitle:'活动数据加载失败',load:loadAll,render:renderPayload});
 view.classList.add('stack-5');
 workspace.append(master,detailColumn);
 return {title:'活动中心',crumb:'活动中心',dispose:()=>{sourceSequence++;refreshSequence++;clearInterval(countdownTimer);},node:h('div',{class:'view wspad wspad--wide stack-5 activity-center'},pageHead({label:'组织运营',title:'活动中心',description:'选择活动，完成配置、审批发布、名单确认、签到和志愿时长录入。',actions:[button({label:'新建活动',variant:'primary',iconName:'plus',onClick:()=>createDrawer()}),button({label:'刷新',variant:'secondary',iconName:'refresh',onClick:async()=>{try{await reload(true);}catch(error){reportError(error,'刷新失败');}}})]}),view)};
}
