import {workspaceNotice,workspaceStage} from '../../public/app/shared/activity-workspace.js';
import process from 'node:process';
export async function seedExamples(origin){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('只能初始化本机隔离预览');
 const root='/api/volunteer/workflow/workspace-drafts',examples=[];
 const flexibleExamples=process.env.PREVIEW_FLEXIBLE_CAPACITY==='1';
 async function api(path,body,method=body?'POST':'GET'){
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json','x-csrf-token':'synthetic-ui'},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(`模拟样例初始化失败 ${path}: ${data.message||response.status}`);return data;
 }
 const login=username=>api('/api/auth/login',{username});
 let fixtureWeek=0;
 const content=(name,mode='grouped',region='nanjing')=>{
  const suzhou=region==='suzhou';
  const value={qqGroup:'123456789',name,region,category:'生命中心',responsibleId:suzhou?'synthetic-suzhou-director':'synthetic-organizer',bookingMode:mode,date:'2030-11-01',endDate:'2030-11-03',deadline:'2030-10-30T18:00',description:'开展校园急救知识宣传与现场志愿服务。此为隔离预览样例。',...(mode==='grouped'?{positions:[['宣传岗','2030-11-01','09:00','11:30'],['签到岗','2030-11-02','13:00','16:00'],['现场引导岗','2030-11-03','08:30','11:00']].map(([name,date,start,end],i)=>({id:'preview-job-'+i,name,date,start,end,campus:suzhou?'苏州':i===1?'鼓楼':'仙林',location:suzhou?'苏州校区活动室':i===1?'鼓楼校区服务台':'仙林校区活动室',capacity:'3',serviceHours:'2',trainingHours:'0',travelHours:'0',work:['急救宣传及演示','签到与秩序维护','现场引导及物料整理'][i]}))}:{start:'09:00',end:'12:00',location:'仙林校区活动室',capacity:'1',serviceHours:'3',trainingHours:'0',travelHours:'0',work:'校园导医及现场秩序维护'})};
  if(flexibleExamples){if(value.positions)value.positions.forEach((job,i)=>{job.flexibleCapacity=i===0?'5':i===1?'10':'0';});else value.flexibleCapacity='5';}
  const anchor=Date.parse('2030-11-01T00:00:00Z')+fixtureWeek++*7*86400000,day=offset=>new Date(anchor+offset*86400000).toISOString().slice(0,10);
  value.date=day(0);value.endDate=day(2);value.deadline=day(-2)+'T18:00';if(value.positions)value.positions.forEach((job,i)=>{job.date=day(i);});
  value.notice=workspaceNotice(value);return value;
 };
 async function draft(name,value){const row=(await api(root,{requestId:'main-preview-'+crypto.randomUUID(),content:value})).result;examples.push({name,stage:'草稿',url:`${origin}/console/events?workspace=v2&draft=${row.id}`,draftId:row.id});return row;}
 await login('synthetic-organizer');
 const first=await draft('新生急救课堂 · 多岗位草稿',content('新生急救课堂 · 多岗位草稿'));
 await login('synthetic-super');
 await draft('社区关怀 · 岗位待选择',{name:'社区关怀 · 岗位待选择',region:'nanjing',category:'博爱中心'});
 await login('synthetic-suzhou-director');
 await draft('苏州校园服务 · 草稿',{name:'苏州校园服务 · 草稿',region:'suzhou',category:'生命中心'});
 async function formal(name,phase,mode='grouped',region='nanjing'){
  const actor=region==='suzhou'?'synthetic-suzhou-director':'synthetic-organizer',chair=region==='suzhou'?'synthetic-suzhou-chair':'synthetic-super';await login(actor);
  const row=(await api(root,{requestId:'main-preview-'+crypto.randomUUID(),content:content(name,mode,region)})).result;
  const proof=(await api(`${root}/${row.id}/preview`,{expectedVersion:1})).result,payload={expectedVersion:1,digest:proof.digest};
  await api(`${root}/${row.id}/confirm-preview`,payload);await api(`${root}/${row.id}/submit`,payload);
  const saved=(await api(`${root}/${row.id}`)).result,event=(await api('/api/volunteer/workflow/catalog')).events.find(e=>e['活动ID']===saved.activityId),base=`/api/volunteer/workflow/events/${event._id}`;
  examples.push({name,stage:phase,url:`${origin}/console/events?workspace=v2&event=${event._id}`,eventId:event._id});
  if(phase==='待审批')return;
  await login(chair);const information=(await api(base+'/workspace-content')).result;await api(base+'/approve',{token:information.token});
  if(phase==='已批准待发布')return;
  if(phase==='定时发布'){await api(base+'/schedule',{publishAt:'2030-10-29T09:00:00+08:00'});return;}
  await api(base+'/publish',{});await login(actor);
  let detail=await api(base+'/detail');const jobs=detail.events.filter(e=>JSON.parse(e['报名页配置']||'{}').bookingMode!=='grouped');
  for(const job of jobs)await api(`/api/portal/workflow/events/${job._id}/register`,{consent:true});
  detail=await api(base+'/detail');
  for(const [i,job]of jobs.entries()){
   const decision=phase==='进行中'||mode==='unified'?'confirm':i===1?'confirm':i===2?'reject':null;if(!decision)continue;
   detail=await api(base+'/detail');const current=detail.events.find(e=>e._id===job._id),ids=detail.registrations.filter(r=>r['活动ID']===job['活动ID']).map(r=>r._id);
   await api(`/api/volunteer/workflow/events/${job._id}/batch-decide`,{ids,decision,reason:decision==='reject'?'很遗憾的通知您，您报名的活动已满':'',immediate:true,token:current.rosterToken});
  }
  if(phase==='进行中'){
   await api(base+'/close',{scope:'project'});const review=(await api(base+'/running-review')).result,reg=(await api(base+'/detail')).registrations[0];
   await api(base+'/running-review',{token:review.token,items:[{id:reg._id,decision:'pass',reason:'',serviceHours:2,trainingHours:0,travelHours:0,evidenceChecked:false,attendanceUrl:'https://example.org/attendance'}]},'PATCH');
  }
 }
 await formal('校园急救培训 · 待主席团审批','待审批');
 await formal('苏州生命教育 · 待苏州主席团审批','待审批','grouped','suzhou');
 await formal('急救宣讲 · 审批通过待发布','已批准待发布');
 await formal('急救宣讲 · 定时发布','定时发布');
 await formal('校园宣传服务 · 多岗位报名中','报名中');
 await formal(flexibleExamples?'校园导医服务 · 单岗位弹性报名':'校园导医服务 · 单岗位已满','报名中','unified');
 await formal('校园引导服务 · 进行中初审','进行中');
 await login('synthetic-super');
 const catalog=(await api('/api/volunteer/workflow/catalog')).events,finals=catalog.filter(row=>row['活动名称'].startsWith('时长审核 · 分工表（合成）-'));
 for(const [i,row]of finals.entries()){
  const base=`/api/volunteer/workflow/events/${row._id}`;
  if(i===0){const sheet=(await api(base+'/final-hours')).result;await api(base+'/final-hours-export',{token:sheet.token});examples.push({name:'已结束 · 最终表下载与邮件状态',stage:'已结束',eventId:row._id,url:`${origin}/console/events?workspace=v2&event=${row._id}`});}
  else if(i===1)examples.push({name:'时长审核 · 通过及未通过明细',stage:'时长审核',eventId:row._id,url:`${origin}/console/events?workspace=v2&event=${row._id}`});
  else{const state=(await api(base+'/workspace-removal')).result;if(state.canRemove)await api(base+'/workspace-removal',{token:state.token,requestId:crypto.randomUUID(),reason:'整理隔离预览样例'});}
 }
 await login('synthetic-organizer');
 const current=(await api('/api/volunteer/workflow/catalog')).events,stages=new Set(['草稿',...current.filter(e=>{const c=JSON.parse(e['报名页配置']||'{}');return c.workspaceSubmission&&!c.parentActivityId&&e['状态']!=='已归档';}).map(workspaceStage)]);
 for(const stage of ['草稿','待审批','报名中','进行中','时长审核','已结束'])if(!stages.has(stage))throw Error('缺少预览阶段：'+stage);
 return {examples,firstUrl:`${origin}/console/events?workspace=v2&draft=${first.id}`,stages:[...stages]};
}
