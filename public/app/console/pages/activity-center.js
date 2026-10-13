import {ACTIVITY_CENTERS,HALF_HOURS,serviceDuration,matchesActivity} from '../../shared/activity-management.js';
import {activityKind,activityRegion} from '../../shared/activity-taxonomy.js';
import {registrationParticipant} from '../../shared/registration-profile.js';
import {rosterPanel,publicationPanel} from './activity-management.js';
import {localizeActivityDate} from './activity-date.js';
import {searchField} from '../../ui/search-field.js';
import {patchQuery} from '../../core/router.js';
import {h,clear} from '../../core/dom.js';
import {request,getSessionState,refreshSession,ApiError} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {asyncRegion} from '../lib.js';
import {serviceWorkspace} from './activity-service.js';
import {pageHead,panel,field,button,badge,segmented,emptyState,notice,definitionList,runWithLoading,checkbox} from '../../ui/primitives.js';
const root='/api/volunteer/workflow';
import {activityProjects,projectEvents} from '../../shared/activity-projects.js';
const config=e=>{try{return JSON.parse(e['报名页配置']||'{}');}catch{return {};}};
const result=r=>r['报名状态']==='待筛选'?'待确认':r['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(r['报名状态'])?'报名成功':r['报名状态'];
export default async function activityCenter(context,shell){
 const serviceStates=new Map();
 let superAdmin=getSessionState().user?.role==='super_admin';
 let actor=getSessionState().user?.accountId||getSessionState().user?.username;
 const selectedRegistrations=new Set();
 let sessionDetail=false;
 const scopedRows=(rows,e)=>{const ids=new Set(projectEvents(data.events,e).map(row=>row['活动ID']));return rows.filter(row=>ids.has(row['活动ID']));};
 let data={events:[],registrations:[],ledger:[],sources:[]},selected=context.query.get('event')||'',mode=['all','review','open','sources','trash'].includes(context.query.get('mode'))?context.query.get('mode'):'open',area=['all','nanjing','suzhou'].includes(context.query.get('area'))?context.query.get('area'):'all',tab=['overview','publish','roster','checkins','hours'].includes(context.query.get('tab'))?context.query.get('tab'):'overview',search=context.query.get('q')||'';
 let category='',directory={administrators:[],participants:[]},directoryError=false;
 async function loadDirectory(){try{directory=await request(root+'/directory');directoryError=Boolean(directory.profileWarning);}catch{directoryError=true;}if(view?.dataset.ready==='true'&&tab==='roster')renderDetail();}
 const countdownTimer=setInterval(()=>{for(const node of detail.querySelectorAll('[data-publish-countdown]')){const left=Math.ceil((Date.parse(node.dataset.publishCountdown)-Date.now())/1000);node.textContent=left>0?`距报名开始 ${Math.ceil(left/60)} 分钟`:'已到报名开始时间';}},1000);
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
  const seed=basis?{...old,center:basis['组织类别']&&basis['组织类别']!=='未分类'?basis['组织类别']:old.center,region:basis['活动地区']==='苏州地区'?'苏州活动':basis['活动地区']==='南京地区'?'南京活动':old.region,name:basis['活动名称'],category:basis['活动类别'],date:basis['报名日期'],slot:basis['报名时段'],position:basis['岗位'],capacity:basis['容量'],serviceHours:basis['服务时长'],trainingHours:basis['培训时长'],travelHours:basis['交通时长'],location:basis['地点'],work:basis['工作内容'],week:old.blood?.week}:source||{};
  const body=h('div',{class:'activity-create-form stack-5'});let drawer;
  function f(name,label,type='text',extra={}){
   const node=field({name,label,type,required:true,value:seed[name]??(['trainingHours','travelHours'].includes(name)?1:''),...extra});
   node.control.required=extra.required!==false;fields.push(node);return node;
  }
  const region=f('region','地区','text',{value:seed.region||'南京活动',options:[{value:'南京活动',label:'南京地区'},{value:'苏州活动',label:'苏州地区'}]});
  const name=f('name','活动名称','text',{placeholder:'例如：5.31 探索人道法',hint:'建议格式：日期＋活动名称',maxlength:500});
  const activityCategory=f('category','活动类型 / 专项','text',{value:seed.category||'',maxlength:500});
  const center=f('center','活动类别','text',{required:false,value:seed.center?activityKind({center:seed.center}):'',options:[{value:'',label:'未分类（待确认）'},...ACTIVITY_CENTERS],hint:'与志愿服务平台的活动类别一致；不同于地区和专项类型。'});
  center.classList.add('activity-category-field');
  const primary=event?event['负责人账号ID']:actor;
  const ownerName=event?directory.administrators.find(a=>a.id===primary)?.name||primary:getSessionState().user?.label||actor;
  const owners=h('section',{class:'activity-owner-fields stack-3'},h('h3',{class:'field__label',text:'负责人'}),h('div',{class:'activity-primary-owner'},h('span',{class:'t-caption',text:'第一负责人'}),h('strong',{text:ownerName})),h('p',{class:'t-caption',text:'补充负责人（可多选）'}),...directory.administrators.filter(a=>a.id!==primary).map(a=>checkbox({label:a.name,checked:coOwners.has(a.id),onChange:checked=>{if(checked)coOwners.add(a.id);else coOwners.delete(a.id);}})),directoryError?notice('管理员列表未加载，请刷新后选择补充负责人。',{tone:'warning'}):null);
  const information=panel({title:'活动信息',body:h('div',{class:'stack-4'},name,center,activityCategory,owners)});
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
  async function save(submit,control){if(fields.some(f=>!f.control.reportValidity()))return;const payload=Object.fromEntries(fields.map(f=>[f.control.name,f.control.value]));payload.slot=chosen==='blood_vehicle'?seed.slot:payload.startTime+'-'+payload.endTime;if(chosen==='blood_vehicle'){payload.week=seed.week;delete payload.startTime;delete payload.endTime;}payload.team=old.team;payload.templateId=chosen;payload.submit=submit;payload.coOwners=[...coOwners];payload.benefits=old.benefits;payload.requirements=old.requirements;payload.publishAt=old.publishAt;let savedRows=[];try{await runWithLoading(control,async()=>{
    if(event){await request(`${root}/events/${event._id}`,{method:'PATCH',body:payload});if(submit)await request(`${root}/events/${event._id}/submit`,{method:'POST',body:{}});selected=event._id;}
    else if(source){const response=await request(`${root}/adopt`,{method:'POST',body:{key:source.key,config:payload}});selected=response.result._id;savedRows=[response.result];if(submit&&response.result['状态']==='草稿')await request(`${root}/events/${selected}/submit`,{method:'POST',body:{}});}
    else{const response=await request(`${root}/events`,{method:'POST',body:payload});selected=response.result._id;savedRows=[response.result];}
   });drawer.close();tab='overview';mode='all';search='';category='';searchInput.setValue('');categoryControl.control.value='';area='all';areaControl.control.value='all';modeControl.setValue(mode);if(savedRows.length){const byId=new Map(data.events.map(row=>[row._id,row]));for(const row of savedRows)byId.set(row._id,row);const output=renderPayload({...data,events:[...byId.values()]});clear(view);for(const node of output)if(node)view.append(node);}
   notify.success(submit?'已提交审批':'草稿已保存');if(!savedRows.length)void refreshAfterWrite();}catch(error){reportError(error,'保存未完成');}}
  let draft,submit;draft=button({label:'保存草稿',variant:'secondary',onClick:()=>save(false,draft)});submit=button({label:'提交审批',variant:'primary',onClick:()=>save(true,submit)});
  drawer=openDrawer({title:event?'编辑活动':source?'完善源表活动':'新建活动',eyebrow:'活动中心',width:680,body,footer:[draft,submit]});
 }
 async function archive(e){const yes=await confirmAction({title:'将活动移到回收站？',description:'可从回收站恢复。已有参与记录的活动不能删除，请使用结束活动。',confirmLabel:'移到回收站'});if(yes)try{await mutate(`/events/${e._id}/archive`);}catch(error){reportError(error,'删除未完成');}}
 function showRecords(e,kind,viewState){if(kind==='roster'&&!config(e).ordinary&&!config(e).blood)return rosterPanel(e,scopedRows(data.registrations,e),{refresh:refreshAfterWrite,directory:directory.participants,directoryError,viewState});const regs=scopedRows(data.registrations,e);const hours=scopedRows(data.ledger,e);
  if(['checkins','hours'].includes(kind)){
   const key=`${e._id}:${kind}`;if(!serviceStates.has(key))serviceStates.set(key,{expanded:true});
   workspace.classList.toggle('is-service-focused',serviceStates.get(key).expanded);
   return serviceWorkspace({event:e,events:projectEvents(data.events,e),registrations:regs,ledger:hours,kind,actor,superAdmin,state:serviceStates.get(key),onNavigate:value=>{tab=value;renderDetail();focusService();},onSaved:async()=>{const saved=await refreshAfterWrite();if(saved)focusService();return saved;}});
  }
  return panel({title:'报名与请假',description:'确认名单后，参与者看到报名成功。请假批准后释放名额。',body:regs.length?h('div',{class:'activity-records'},h('div',{class:'row-2 row-wrap'},button({label:'全选可处理报名',size:'sm',onClick:()=>{for(const r of regs)if(r['报名状态']==='待筛选'&&r['请假状态']!=='待审批')selectedRegistrations.add(r._id);renderDetail();}}),button({label:'批量确认报名',variant:'primary',size:'sm',onClick:()=>batchRecords(e)})),...regs.map(r=>h('article',{class:'activity-person'},r['报名状态']==='待筛选'&&r['请假状态']!=='待审批'?h('input',{type:'checkbox',checked:selectedRegistrations.has(r._id),'aria-label':`选择${r['姓名']}`,on:{change:ev=>{if(ev.target.checked)selectedRegistrations.add(r._id);else selectedRegistrations.delete(r._id);}}}):null,h('div',{class:'row-between row-wrap'},h('strong',{text:r['姓名']}),badge(result(r),{tone:['已确认','已签到'].includes(r['报名状态'])?'success':'warning'})),h('p',{class:'t-caption',text:`${r['学号']} · ${r['报名日期']||''} ${r['报名时段']||''} · ${r['地点']||data.events.find(e=>e['活动ID']===r['活动ID'])?.['地点']||''} · ${r['岗位']} · ${r['报名类型']||'普通报名'}`}),r['处理说明']?h('p',{class:'t-caption',text:r['处理说明']}):null,
   h('div',{class:'row-2 row-wrap'},button({label:'更多资料',size:'sm',onClick:()=>{const p=registrationParticipant(r,directory.participants.find(p=>p.accountId===r['账号ID'])||{});openDrawer({title:`志愿者资料 · ${r['姓名']}`,body:[definitionList([['姓名',r['姓名']],['学号',r['学号']],['邮箱',r['邮箱']||p.email||'未提供'],['校区',p.campus||'未提供'],['院系',p.department||'未提供'],['年级',p.grade||'未提供'],['性别',p.gender||'未提供'],['电话',p.phone||'未提供'],['QQ',p.qq||'未提供'],['急救证',p.certificate||'未知'],['活动类别',r['活动类型']?r['活动类别']||'未分类':'未分类'],['地区',r['地区']||'未提供'],['备注',r['备注']||'无'],['备注2',r['备注2']||'无'],['注意事项',r['注意事项']||'无'],['资料来源',r['资料来源']||'历史报名资料'],['关联状态',r['关联状态']||'待完善']])]});}}),r['报名状态']==='待筛选'&&r['请假状态']!=='待审批'?action('确认报名成功',`/registrations/${r._id}/confirm`,{},true):null,r['报名状态']==='待筛选'&&r['请假状态']!=='待审批'?button({label:'报名失败',size:'sm',onClick:()=>reasonAction('标记报名失败',`/registrations/${r._id}/reject`)}):null,r['请假状态']==='待审批'?h('div',{class:'stack-3'},notice(`请假：${r['请假原因']}`,{tone:'warning'}),h('div',{class:'row-2 row-wrap'},button({label:'批准请假',size:'sm',onClick:()=>reasonAction('批准请假',`/registrations/${r._id}/leave-approve`)}),button({label:'驳回请假',size:'sm',onClick:()=>reasonAction('驳回请假',`/registrations/${r._id}/leave-reject`)}))):r['请假状态']?badge(`请假${r['请假状态']}`):null)))):emptyState({title:'暂无报名记录',description:'审批并发布活动后，报名记录会显示在这里。'})});
 }
 async function batchRecords(e){
  const ids=scopedRows(data.registrations,e).filter(r=>r['报名状态']==='待筛选'&&r['请假状态']!=='待审批'&&selectedRegistrations.has(r._id)).map(r=>r._id);
  if(!ids.length){notify.warning('请先选择待确认的报名记录');return;}
  try{const out=await request(root+'/registrations/batch',{method:'POST',body:{ids,action:'confirm'}});
   for(const r of out.results)if(r.ok)selectedRegistrations.delete(r.id);
   await refreshAfterWrite();const failed=out.results.filter(r=>!r.ok);
   if(failed.length)notify.warning(`${failed.length} 条未完成`,failed.map(r=>r.message).join('；'));else notify.success(`已确认 ${out.results.length} 条报名`);
  }catch(error){reportError(error,'批量确认未完成');}
 }
 function focusService(){requestAnimationFrame(()=>detail.querySelector('.service-workspace')?.focusWorkspace());}
 function renderProject(e,viewState){
  const sessions=projectEvents(data.events,e),regs=scopedRows(data.registrations,e);
  const dates=[...new Set(sessions.map(row=>row['报名日期']))].sort();
  const pending=sessions.some(row=>config(row).ordinary?.hoursPending);
  detail.append(h('header',{class:'activity-detail-head stack-4'},
   h('div',{class:'row-between row-wrap'},badge('活动项目',{tone:'accent'}),badge(e['状态'],{tone:'success'})),
   h('h2',{class:'t-h2',text:activityProjects(sessions)[0].projectName}),
   h('p',{class:'t-caption',text:`${dates[0]} — ${dates.at(-1)} · ${sessions.length} 个班次 · ${sessions.reduce((sum,row)=>sum+Number(row['容量']||0),0)} 个名额 · ${regs.length} 条报名`}),
   segmented({items:[{value:'overview',label:'项目与班次'},{value:'publish',label:'统一报名设置'},{value:'roster',label:`报名 ${regs.length}`},{value:'checkins',label:'签到核验'},{value:'hours',label:'时长审核与导出'}],value:tab,ariaLabel:'活动管理环节',onChange:value=>{tab=value;renderDetail();}})));
  if(tab==='publish'){
   if(config(e).blood){detail.append(notice('献血车班次由 NJUTable 排班表维护。在项目与班次中查看各班次配置。',{tone:'neutral'}));return;}
   const cutoff=field({label:'统一报名截止（北京时间）',type:'datetime-local',value:(e.registrationControl?.deadline||'').slice(0,16),required:true});
   const save=enabled=>async()=>{if(!cutoff.control.reportValidity())return;try{await mutate(`/events/${encodeURIComponent(e._id)}/registration-settings`,{deadline:`${cutoff.control.value}:00+08:00`,enabled},'PATCH');}catch(error){reportError(error,'报名设置未保存');}};
   detail.append(panel({title:'整个项目的报名设置',body:h('div',{class:'stack-4'},definitionList([['项目编号',config(e).ordinary.groupId],['报名开关',e.registrationControl?.enabled?'开放':'关闭']]),cutoff,h('div',{class:'row-2 row-wrap'},button({label:'保存截止并开放报名',onClick:save(true)}),button({label:'立即停止报名',onClick:save(false)})))}));return;
  }
  if(['checkins','hours'].includes(tab)&&pending){
   const eligible=regs.filter(r=>r['报名状态']==='已确认'&&r['请假状态']!=='待审批');
   detail.append(h('div',{class:'row-2 row-wrap'},button({label:'选择可核验报名（最多100条）',onClick:()=>{selectedRegistrations.clear();for(const r of eligible.slice(0,100))selectedRegistrations.add(r._id);renderDetail();}}),button({label:'批量核验选中签到',variant:'primary',onClick:async()=>{
    const ids=eligible.filter(r=>selectedRegistrations.has(r._id)).map(r=>r._id);
    if(!ids.length||ids.length>100){notify.warning('请选择1～100条待核验报名');return;}
    if(!await confirmAction({title:`核验 ${ids.length} 条现场签到？`,description:'请确认所选志愿者已实际到场；只记录签到，不录入时长。',confirmLabel:'确认现场签到'}))return;
    try{const out=await request(root+'/registrations/batch',{method:'POST',body:{ids,action:'checkin'}});for(const r of out.results)if(r.ok)selectedRegistrations.delete(r.id);await refreshAfterWrite();const failed=out.results.filter(r=>!r.ok);if(failed.length)notify.warning(`${failed.length} 条未完成`,failed.map(r=>r.message).join('；'));else notify.success(`已核验 ${out.results.length} 条签到`);}catch(error){reportError(error,'批量核验未完成');}
   }})));
   detail.append(panel({title:'项目签到核验',description:'时长规则待确定，暂不录入或导出时长。',body:regs.length?h('div',{class:'activity-records'},...regs.map(r=>h('article',{class:'activity-person stack-3'},eligible.includes(r)?checkbox({label:'选择'+r['姓名'],checked:selectedRegistrations.has(r._id),onChange:checked=>{if(checked)selectedRegistrations.add(r._id);else selectedRegistrations.delete(r._id);}}):null,h('div',{class:'row-between row-wrap'},h('strong',{text:r['姓名']}),badge(result(r))),h('p',{class:'t-caption',text:`${r['报名日期']} · ${r['报名时段']} · ${sessions.find(s=>s['活动ID']===r['活动ID'])?.['地点']||''}`}),r['报名状态']==='已确认'&&r['请假状态']!=='待审批'?action('仅核验现场签到',`/registrations/${r._id}/checkin`,{note:'管理员核验现场到场'},true):null))):emptyState({title:'暂无报名记录'})}));return;
  }
  if(tab!=='overview'){detail.append(showRecords(e,tab,viewState));return;}
  detail.append(panel({title:'班次安排',description:'项目统一管理报名与时长；选择班次查看具体岗位配置。',body:h('div',{class:'activity-project-sessions'},...sessions.map(s=>{
   const own=regs.filter(r=>r['活动ID']===s['活动ID']);
   return h('article',{class:'activity-person stack-3'},h('div',{class:'row-between row-wrap'},h('strong',{text:`${s['报名日期']} · ${s['报名时段']}`}),badge(s['状态'])),h('p',{text:s['地点']}),h('p',{class:'t-caption',text:`${s['岗位']} · ${own.length} 条报名 / ${s['容量']} 个名额`}),button({label:'查看班次配置',size:'sm',onClick:()=>{selected=s._id;sessionDetail=true;renderDetail();}}));
  }))}));
 }
 function renderDetail(){const viewState=detail.querySelector('.activity-roster')?.getViewState?.();patchQuery({event:selected,mode,area,tab,q:search});clear(detail);workspace.classList.remove('is-service-focused');detail.classList.toggle('is-service-stage',['checkins','hours'].includes(tab));const e=data.events.find(e=>e._id===selected||e['活动ID']===selected),source=data.sources.find(s=>s.key===selected);
  if(!e){detail.append(source?panel({title:source.name,description:'请补全活动信息。',body:h('div',{class:'stack-4'},badge('待配置',{tone:'warning'}),definitionList([['来源表',source.table],['日期',source.date||'待填写'],['时段 / 岗位',[source.slot,source.position].filter(Boolean).join(' · ')||'待填写']]),notice('补全活动信息后提交审批。',{tone:'neutral'}),button({label:'完善配置并纳入流程',variant:'primary',onClick:()=>createDrawer({source})}))}):emptyState({title:'选择活动开始管理',description:'新建活动或选择待配置的源表活动。'}));return;}
  if((config(e).ordinary||config(e).blood)&&!sessionDetail){renderProject(e,viewState);return;}
  if(config(e).ordinary||config(e).blood){detail.append(button({label:'返回活动项目',onClick:()=>{sessionDetail=false;renderDetail();}}));}
  if(config(e).ordinary){
   const group=data.events.filter(row=>config(row).ordinary?.groupId===config(e).ordinary.groupId);
   const cutoff=field({label:'统一报名截止（北京时间）',type:'datetime-local',value:(e.registrationControl?.deadline||'').slice(0,16),required:true});
   const save=enabled=>async()=>{if(!cutoff.control.reportValidity())return;try{await mutate(`/events/${encodeURIComponent(e._id)}/registration-settings`,{deadline:`${cutoff.control.value}:00+08:00`,enabled},'PATCH');notify.success(enabled?'报名设置已保存':'已停止整个活动的新报名');}catch(error){reportError(error,'报名设置未保存');}};
   detail.append(panel({title:'普通活动项目 · 统一报名设置',body:h('div',{class:'stack-3'},definitionList([['项目编号',config(e).ordinary.groupId],['班次 / 总名额',`${group.length} / ${group.reduce((n,row)=>n+Number(row['容量']),0)}`],['报名开关',e.registrationControl?.enabled?'开放':'关闭'],['规则','名额直接确认；取消需审核；满额可订阅提醒；时长待确定']]),cutoff,h('div',{class:'row-2 row-wrap'},button({label:'保存截止并开放报名',onClick:save(true)}),button({label:'立即停止报名',variant:'secondary',onClick:save(false)})),notice('设置作用于整个项目。停止报名不会取消已有记录，也不关闭签到核验。',{tone:'neutral'}))}));
   if(config(e).ordinary.hoursPending&&['checkins','hours'].includes(tab)){
    const regs=scopedRows(data.registrations,e);
    detail.append(panel({title:'时长规则待确定',body:h('div',{class:'stack-3'},notice('当前不能录入或导出时长。可独立核验已确认报名的现场签到。',{tone:'warning'}),...regs.map(r=>h('div',{class:'row-between row-wrap'},h('span',{text:`${r['姓名']} · ${r['报名状态']}`}),r['报名状态']==='已确认'&&r['请假状态']!=='待审批'?action('仅核验现场签到',`/registrations/${r._id}/checkin`,{note:'管理员核验现场到场'},true):null)))}));return;
   }
  }
  const regs=scopedRows(data.registrations,e),hours=data.ledger.filter(l=>l['活动ID']===e['活动ID']);const editable=config(e).source?.kind!=='generated_blood'&&!['报名中','已结束','停点','已归档'].includes(e['状态'])&&!regs.length;
  const stage=['草稿','待配置','待审核'].includes(e['状态'])?0:e['状态']==='可发布'?1:hours.length?4:regs.some(r=>r['报名状态']==='已签到')?3:2;
  const next=e['状态']==='草稿'?action('提交审批',`/events/${e._id}/submit`,{},true):e['状态']==='待审核'&&(superAdmin||e['负责人账号ID']!==actor&&config(e).lastEditor!==actor)?action('审批通过',`/events/${e._id}/approve`,{},true):e['状态']==='可发布'?action('发布报名',`/events/${e._id}/publish`,{},true):null;
  detail.append(h('header',{class:'activity-detail-head stack-4'},h('div',{class:'row-between row-wrap'},badge(e['状态'],{tone:e['状态']==='报名中'?'success':'neutral'}),badge(e['活动类别'],{tone:'accent'})),h('h2',{class:'t-h2',text:e['活动名称']}),h('p',{class:'t-caption',text:`${e['报名日期']} · ${e['报名时段']} · ${e['地点']}`}),h('div',{class:'row-2 row-wrap'},next,e['状态']==='报名中'?button({label:'查看报名页面',size:'sm',href:`/workflow-events?event=${encodeURIComponent(e._id)}`}):null,config(e).source?.kind==='generated_blood'?null:button({label:'复制为新活动',size:'sm',onClick:()=>createDrawer({copy:e})}),e['状态']==='待审核'&&e['负责人账号ID']===actor&&!superAdmin?badge('待审批',{tone:'warning'}):null,editable?button({label:'编辑配置',size:'sm',onClick:()=>createDrawer({event:e})}):null,e['状态']==='已归档'?action('恢复活动',`/events/${e._id}/restore`):!regs.length&&config(e).source?.kind!=='generated_blood'?button({label:'删除活动',variant:'ghost',size:'sm',onClick:()=>archive(e)}):null,config(e).source?.kind!=='generated_blood'&&['报名中','停点'].includes(e['状态'])?button({label:sessionDetail?'结束此班次':'结束活动',size:'sm',onClick:async()=>{const yes=await confirmAction({title:sessionDetail?'结束此班次？':'结束该活动？',description:'结束后关闭新报名与签到，已有签到和时长记录保留。',confirmLabel:'结束活动'});if(yes)try{await mutate(`/events/${e._id}/close`);}catch(error){reportError(error,'结束未完成');}}}):null,config(e).blood&&config(e).source?.kind!=='generated_blood'&&e['状态']==='报名中'?button({label:'停点',variant:'ghost',size:'sm',onClick:()=>reasonAction('停点并显示原因',`/events/${e._id}/stop`)}):null)),...(e['报名日期']<new Date(Date.now()+8*3600000).toISOString().slice(0,10)?[notice('活动日期已过去。开展新一期活动时，请复制并修改日期。',{tone:'warning'})]:[]),h('ol',{class:'activity-stages','aria-label':'活动进度'},...['申请审批','发布报名','名单确认','签到核验','时长审核'].map((text,i)=>h('li',{class:i<stage?'is-done':i===stage?'is-current':'',text:`${i+1} ${text}`}))),segmented({items:[{value:'overview',label:'概览与审批'},{value:'publish',label:'发布报名'},{value:'roster',label:`报名 ${regs.length}`},{value:'checkins',label:'签到核验'},{value:'hours',label:'时长审核与导出'}],value:tab,ariaLabel:'活动管理环节',onChange:value=>{tab=value;sessionDetail=false;renderDetail();if(['checkins','hours'].includes(tab))focusService();}}));
  if(tab==='publish'){detail.append(config(e).ordinary?notice('多班次项目使用下方统一截止与报名开关，不修改单个班次通知。',{tone:'neutral'}):config(e).source?.kind==='generated_blood'?notice('献血车班次由 NJUTable 排班表维护。',{tone:'neutral'}):publicationPanel(e,{config:config(e),mutate,editable}));return;}
  if(config(e).source?.kind==='generated_blood'&&['overview','roster'].includes(tab))detail.append(h('details',{class:'activity-position-details'},h('summary',{text:'查看各名额报名情况'}),asyncRegion({load:()=>request(`${root}/events/${encodeURIComponent(e._id)}/positions`),render:payload=>h('div',{class:'activity-position-list'},...payload.positions.map(p=>h('article',{class:'activity-person'},h('div',{class:'row-between'},h('b',{text:`名额 ${p.position}`}),badge(p.status)),definitionList(Object.entries(p.profile).filter(([,v])=>v)))))})));
  if(tab!=='overview'){detail.append(showRecords(e,tab,viewState));return;}
  detail.append(panel({title:'活动配置',body:definitionList([['岗位 / 名额',`${e['岗位']} · ${e['容量']} 人`],['服务时长',config(e).ordinary?.hoursPending?'规则待确定':`${e['服务时长']} 小时`],['培训 / 交通',`${e['培训时长']} / ${e['交通时长']} 小时`],['工作内容',e['工作内容']],['参与情况',`${regs.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length} 人已确认 · ${regs.filter(r=>r['报名状态']==='已签到').length} 人已核验 · ${hours.filter(l=>l['状态']==='已入账').length} 笔已入账`],[config(e).source?.kind==='generated_blood'?'班次来源':'审批记录',config(e).source?.kind==='generated_blood'?'NJUTable 排班表':e['审批人']?`版本 ${e['批准版本']} · ${e['审批时间']}`:'尚未通过审批']])}),panel({title:'报名通知',description:'创建或编辑配置时自动生成，发布前可检查。',body:h('div',{class:'stack-4'},h('p',{class:'activity-notice',text:e['通知草稿']||'补全配置后生成通知'}),editable?button({label:'编辑通知',size:'sm',onClick:()=>{const text=field({label:'报名通知',value:e['通知草稿'],multiline:true,rows:8,required:true,maxlength:5000});let drawer;drawer=openDrawer({title:'编辑报名通知',description:'保存后需重新提交审批，确保发布内容得到审核。',body:[text],footer:[button({label:'保存通知',variant:'primary',onClick:async()=>{if(!text.control.reportValidity())return;try{await mutate(`/events/${e._id}/notice`,{text:text.control.value},'PATCH');drawer.close();}catch(error){reportError(error,'通知未保存');}}})]});}}):null,button({label:'复制通知',size:'sm',onClick:async()=>{try{await navigator.clipboard.writeText(e['通知草稿']||'');notify.success('已复制');}catch(error){reportError(error,'复制未完成');}}}),button({label:'查看时长审核表',variant:'ghost',size:'sm',onClick:()=>{tab='hours';renderDetail();focusService();}}))}));
 }
 function renderList({preserveDetail=false}={}){patchQuery({event:selected,mode,area,tab,q:search});clear(list);const adopted=new Set(data.events.map(e=>config(e).source?.key).filter(Boolean));const items=[...activityProjects(data.events).map(e=>({id:e._id,name:e.projectName,blood:Boolean(config(e).blood),status:e['状态']||'待配置',date:e['报名日期'],slot:e.sessions.length>1?e.sessions.length+' 个班次':e['报名时段'],category:e['活动类别'],center:e['组织类别']||config(e).center,region:e['活动地区']||config(e).region,location:e['地点']})),...data.sources.filter(s=>!adopted.has(s.key)).map(s=>({id:s.key,name:s.name,status:'待配置',date:s.date,category:s.category,source:s.table}))].filter(e=>matchesActivity(e,{mode,category,search})&&(area==='all'||activityRegion({...e,type:e.category})===area)&&(mode==='trash'?e.status==='已归档':e.status!=='已归档')&&(mode==='all'||mode==='trash'||mode==='review'&&['草稿','待审核'].includes(e.status)||mode==='open'&&['报名中','停点'].includes(e.status)||mode==='sources'&&e.status==='待配置')&&`${e.name} ${e.category} ${e.date}`.toLowerCase().includes(search.toLowerCase()));
  const project=activityProjects(data.events).find(p=>p.sessions.some(e=>e._id===selected||e['活动ID']===selected));if(project&&!sessionDetail)selected=project._id;
  if(!items.some(e=>e.id===selected||sessionDetail&&e.id===project?._id)){selected=items[0]?.id||'';}
  if(!items.length)list.append(mode==='sources'&&data.sourcesLoading?notice('正在加载待配置活动…',{tone:'neutral'}):emptyState({title:'没有符合条件的活动',description:'调整筛选条件，或新建活动。'}));
  for(const e of items)list.append(h('button',{type:'button',class:'activity-list-item',aria:{pressed:String(e.id===selected||sessionDetail&&e.id===project?._id)},on:{click:()=>{selected=e.id;sessionDetail=false;tab='overview';renderList();renderDetail();}}},h('div',{class:'row-between row-wrap'},badge(e.status,{tone:e.status==='报名中'?'success':'neutral'}),h('span',{class:'t-caption',text:e.date||'日期待定'})),h('strong',{text:e.name}),h('span',{class:'t-caption',text:e.source?`${e.category} · ${e.source}`:[e.category,e.slot].filter(Boolean).join(' · ')})));
  if(!preserveDetail)renderDetail();
 }
 const categoryControl=field({label:'活动类别',value:category,options:[{value:'',label:'全部类别'},...ACTIVITY_CENTERS,'未分类'],onInput:()=>{category=categoryControl.control.value;renderList();}});categoryControl.classList.add('activity-category-field');

 const modeControl=segmented({items:[{value:'all',label:'全部'},{value:'review',label:'待审批'},{value:'open',label:'进行中'},{value:'sources',label:'待配置'},{value:'trash',label:'回收站'}],value:mode,ariaLabel:'活动状态筛选',onChange:value=>{mode=value;modeControl.setValue(value);renderList();}});
 const areaControl=field({label:'活动地区',value:area,options:[{value:'all',label:'全部'},{value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}],onInput:()=>{area=areaControl.control.value;renderList();}});
 const searchInput=searchField({value:search,label:'搜索活动',placeholder:'搜索活动名称、类型或日期',onSearch:value=>{search=value;renderList();}});
 async function loadSources(){
  const sequence=++sourceSequence;data={...data,sourcesLoading:true};
  try{
   const payload=await request(root+'/sources');
   if(sequence!==sourceSequence)return;
   data={...data,sources:payload.sources,sourceWarnings:payload.warnings||[],sourceError:false,sourcesLoading:false};
  }catch{if(sequence!==sourceSequence)return;data={...data,sourceError:true,sourcesLoading:false};}
  if(view?.dataset.ready==='true'){
   if(mode==='sources'||data.sources.some(s=>s.key===selected))updatePayload(data);else{renderList({preserveDetail:true});const count=summary.lastElementChild?.querySelector('strong');if(count)count.textContent=String(data.sources.filter(s=>!data.events.some(e=>config(e).source?.key===s.key)).length);}
  }
 }
 async function loadAll(){
  if(!getSessionState().authenticated)await refreshSession();
  const current=getSessionState();if(!current.authenticated)throw new ApiError('登录已失效，请重新登录。',{status:401});
  superAdmin=current.user.role==='super_admin';actor=current.user.accountId||current.user.username;
  // Existing managed activities do not wait for the much larger source catalogue.
  const sources=loadSources();
  void loadDirectory();
  const payload=await request(root);
  void sources;
  return {...payload,sources:data.sources,sourceWarnings:data.sourceWarnings||[],sourceError:data.sourceError,sourcesLoading:data.sourcesLoading!==false};
 }

 function renderPayload(payload){view.dataset.ready='true';data=payload;clear(summary);const active=activityProjects(data.events).filter(e=>e['状态']!=='已归档'),adopted=new Set(data.events.map(e=>config(e).source?.key));summary.append(...[['活动项目',active.length],['待审批',active.filter(e=>['草稿','待审核'].includes(e['状态'])).length],['报名中',active.filter(e=>e['状态']==='报名中').length],['源表待配置',data.sourcesLoading?'…':data.sources.filter(s=>!adopted.has(s.key)).length]].map(([label,value])=>h('div',{},h('strong',{text:value}),h('span',{text:label}))));if(!selected)selected=active.find(e=>['报名中','停点'].includes(e['状态']))?._id||active[0]?._id||data.sources[0]?.key||'';renderList();renderDetail();return [payload.sourceError?notice('源表活动暂未加载成功，现有网站活动仍可管理。请刷新重试。',{tone:'warning'}):null,...payload.sourceWarnings.map(text=>notice(text,{tone:'warning'})),summary,modeControl,workspace];}
 view=asyncRegion({errorTitle:'活动数据加载失败',load:loadAll,render:renderPayload});
 view.classList.add('stack-5');
 workspace.append(h('aside',{class:'activity-master'},h('div',{class:'activity-list-tools stack-3'},areaControl,categoryControl,searchInput),list),detail);
 return {title:'活动管理',crumb:'活动管理',dispose:()=>{sourceSequence++;refreshSequence++;clearInterval(countdownTimer);searchInput.dispose();},node:h('div',{class:'view wspad wspad--wide stack-5 activity-center'},pageHead({title:'活动管理',description:'选择活动，完成配置、审批发布、名单确认、签到和志愿时长录入。',actions:[button({label:'新建活动',variant:'primary',iconName:'plus',onClick:()=>createDrawer()}),button({label:'刷新',variant:'secondary',onClick:async()=>{try{await reload(true);}catch(error){reportError(error,'刷新失败');}}})]}),h('nav',{class:'console-project-tabs',aria:{label:'活动管理视图'}},button({label:'活动流程',href:'/console/events',variant:'primary'}),button({label:'服务记录核对',href:'/console/volunteers',variant:'secondary'})),view)};
}
