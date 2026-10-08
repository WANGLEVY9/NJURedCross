/** Isolated browser QA: synthetic in-memory rows; no .env, SMTP or SeaTable. */
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {json} from '../lib/http/response.js';
import {apiFailure} from '../lib/http/errors.js';
import {createStaticHandler} from '../lib/http/static.js';
let seq=0;const rows=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));
const base={async getMetadata(){return{tables:Object.keys(rows).map(name=>({name}))};},async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(rows[t].slice(s,s+n));},async appendRow(t,row){const r={...row,_id:`synthetic-${++seq}`};rows[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){Object.assign(rows[t].find(r=>r._id===id),patch);}};
rows['活动报名总表']=[{_id:'legacy1',活动类别:'志愿服务',活动名称:'校园生命教育宣传',报名日期:'2026-10-10',报名时段:'下午',岗位:'宣传岗',姓名:'仅合成',学号:'999990003'}];rows['登记审批']=[{_id:'app1',活动名称:'秋季急救培训',活动类别:'急救培训',活动日期:'2026-10-12'}];
rows['市血液献血车排班表（模板表）']=[{_id:'template',序号:'周一',点位:'新街口中央',活动时间:'上午 11~15点'}];
let clock=Date.parse('2026-10-04T12:00:00+08:00');
let liveClock=false;const workflow=createWorkflow(base,{now:()=>liveClock?Date.now():clock});const account={accountId:'synthetic-ui',studentId:'999990001',realName:'合成测试同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
const e=await workflow.create({name:'工位值班（合成界面测试）',date:'2026-10-04',slot:'上午',position:'现场服务岗',capacity:3,serviceHours:2,trainingHours:0.5,travelHours:1,location:'合成测试地点',work:'协助现场引导与签到核验'},'synthetic-organizer');await workflow.approve(e._id,'synthetic-reviewer');await workflow.publish(e._id);const r=await workflow.register(e._id,account);await workflow.confirm(r._id);await workflow.checkin(r._id,'synthetic-checker','合成到场核验');const l=await workflow.reviewHours(r._id,'synthetic-hour-checker');await workflow.approveHours(l._id,'synthetic-reviewer');await workflow.post(l._id);
const blood=await workflow.prepareBloodWeek({monday:'2026-10-05',week:45,capacity:1,serviceHours:2},'synthetic-organizer');const b=blood.events[0];await workflow.approve(b._id,'synthetic-reviewer');await workflow.publish(b._id);const br=await workflow.register(b._id,account);await workflow.confirm(br._id);clock=Date.parse('2026-10-05T11:15:00+08:00');
// Rich synthetic examples for activity-management review; no remote services.
clock=Date.now();liveClock=true;
const demoPeople=Array.from({length:12},(_,i)=>({accountId:'preview-person-'+i,studentId:String(999991000+i),realName:['林同学','陈同学','王同学','周同学'][i%4]+(i+1),email:String(999991000+i)+'@smail.nju.edu.cn',emailVerified:true,role:'member',campus:['仙林校区','鼓楼校区','苏州校区'][i%3],department:'合成测试院系',grade:'2025级',certificateStatus:i%3===0?'unknown':i%2?'yes':'no',certificate:i%2?'急救证书（合成资料）':'',coreMemberStatus:i%3===0?'yes':'no'}));
const showcase=await workflow.create({name:'10.12 钟山风景区救护保障',category:'志愿服务',center:'生命类',team:'应急救护服务队',region:'南京活动',date:'2026-10-12',slot:'08:00-17:00',startTime:'08:00',endTime:'17:00',position:'救护保障岗',capacity:8,registrationLimit:12,serviceHours:9,location:'校外：南京市钟山风景区',content:'协助景区工作人员开展应急救护保障',work:'现场救护保障、游客引导与秩序维护'},'synthetic-organizer');
await workflow.approve(showcase._id,'synthetic-reviewer');await workflow.publish(showcase._id);
for(let i=0;i<demoPeople.length;i++){const row=await workflow.register(showcase._id,demoPeople[i]);rows[WF.registrations].find(r=>r._id===row._id)['创建时间']=new Date(clock-(12-i)*300000).toISOString();}
await workflow.create({name:'10.15 苏州校园生命教育',center:'苏州类',region:'苏州活动',date:'2026-10-15',slot:'14:00-16:00',position:'',capacity:20,registrationLimit:30,serviceHours:2,location:'校内：苏州校区',work:'开展生命教育宣传',submit:false},'synthetic-organizer');
const ready=await workflow.create({name:'10.16 博爱公益课堂',center:'博爱类',date:'2026-10-16',slot:'14:00-16:00',position:'',capacity:20,registrationLimit:30,serviceHours:2,location:'校内：仙林校区',work:'开展公益知识课堂'},'synthetic-organizer');await workflow.approve(ready._id,'synthetic-reviewer');
// Presentation scenarios are isolated fixtures; sending only records mock receipts.
const syntheticMailStatuses=new Map();
const mockMailStatuses=async keys=>Object.fromEntries(keys.map(key=>[key,syntheticMailStatuses.get(key)||{status:'not_sent',sentAt:''}]));
const mockSendResultMail=async message=>{
 const failed=process.env.PREVIEW_MAIL_FAIL==='1';
 syntheticMailStatuses.set(message.idempotencyKey,{status:failed?'failed':'sent',sentAt:failed?'':new Date().toISOString()});
 return {ok:!failed,transport:'synthetic'};
};
const scheduled=await workflow.create({name:'10.18 探索人道法',category:'公益课堂',center:'博爱类',date:'2026-10-18',slot:'14:00-16:00',startTime:'14:00',endTime:'16:00',capacity:16,registrationLimit:24,serviceHours:2,trainingHours:0.5,travelHours:0,location:'校内：仙林校区教学楼',work:'课堂讲解、案例讨论与现场互动',publishAt:'2026-10-10T09:30:00+08:00'},'synthetic-organizer');
await workflow.approve(scheduled._id,'synthetic-reviewer');
async function prepareRosterDemo(config,{accepted=3,finalized=false}={}){
 const event=await workflow.create({...config,category:'志愿服务',region:'南京活动',capacity:accepted,registrationLimit:8,trainingHours:0.5,travelHours:0.5},'synthetic-organizer');
 await workflow.approve(event._id,'synthetic-reviewer');await workflow.publish(event._id);
 const registrations=[];
 for(let i=0;i<6;i++){
  const row=await workflow.register(event._id,demoPeople[i]);registrations.push(row);
  rows[WF.registrations].find(r=>r._id===row._id)['创建时间']=new Date(clock-(6-i)*600000).toISOString();
 }
 const token=async()=>((await workflow.overview()).events.find(e=>e._id===event._id)).rosterToken;
 await workflow.stageRoster(event._id,registrations.slice(0,accepted).map(r=>r._id),'confirm','',await token());
 await workflow.stageRoster(event._id,registrations.slice(accepted).map(r=>r._id),'reject','本次活动名额有限，感谢参与，欢迎报名后续活动。',await token());
 if(finalized){
  await workflow.finalizeRoster(event._id,await token(),'synthetic-reviewer');
  await workflow.deliverRoster(event._id,{send:mockSendResultMail,statuses:mockMailStatuses});
 }
}
await prepareRosterDemo({name:'10.17 校园应急救护宣传',center:'生命类',date:'2026-10-17',slot:'09:00-11:30',startTime:'09:00',endTime:'11:30',serviceHours:2.5,location:'校内：仙林校区大学生活动中心',work:'演示心肺复苏、协助体验教学与宣传引导'});
await prepareRosterDemo({name:'10.19 社区关怀志愿服务',center:'博爱类',date:'2026-10-19',slot:'14:00-16:30',startTime:'14:00',endTime:'16:30',serviceHours:2.5,location:'校外：南京市仙林街道社区服务中心',work:'协助社区关怀活动、物资整理与现场服务'},{accepted:4,finalized:true});
const staticFile=createStaticHandler(fileURLToPath(new URL('../public/',import.meta.url)));
const session={username:'synthetic-reviewer',role:process.env.PREVIEW_SUPER_ADMIN==='1'?'super_admin':'platform_admin',csrf:'synthetic-ui'};
if(session.role==='super_admin'){
 const own=await workflow.create({name:'超级管理员时长审批（合成）',date:'2026-10-05',slot:'上午',position:'合成服务岗',capacity:2,serviceHours:2,trainingHours:0,travelHours:0,location:'合成测试场地',work:'仅供测试'},session.username);
 await workflow.approve(own._id,session.username,session.role);await workflow.publish(own._id);
 const registration=await workflow.register(own._id,account);await workflow.confirm(registration._id);await workflow.checkin(registration._id,session.username,'合成证据');await workflow.reviewHours(registration._id,session.username);
}

let signedIn=process.env.PREVIEW_START_SIGNED_OUT!=='1';
let previewPermissions=['materials','events','outreach','community','data','settings','accounts'];
const sessionPayload=()=>signedIn?{ok:true,authenticated:true,csrfToken:session.csrf,user:{...session,roleLabel:'运营管理员',consoleAccess:true,permissions:previewPermissions,label:'合成测试审核人',surfaces:['console','portal']}}:{ok:true,authenticated:false};
let overviewRequests=0;
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
if(process.env.PREVIEW_TRACE==='1')console.log(req.method,url.pathname);
if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow'&&++overviewRequests===Number(process.env.PREVIEW_REFRESH_FAIL_AT))return json(res,503,{ok:false,message:'合成刷新故障'});
// Optional latency injection is confined to this synthetic server.
if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow'&&process.env.PREVIEW_REFRESH_DELAY_MS)await new Promise(resolve=>setTimeout(resolve,Number(process.env.PREVIEW_REFRESH_DELAY_MS)));
if(url.pathname==='/api/auth/session')return json(res,200,sessionPayload());
if(url.pathname==='/api/auth/login'){
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
 signedIn=true;session.username=body.username||'synthetic-reviewer';previewPermissions=body.username==='synthetic-events-only'?['events']:['materials','events','outreach','community','data','settings','accounts'];
 return json(res,200,sessionPayload());
}
if(url.pathname==='/api/auth/logout'){signedIn=false;return json(res,200,{ok:true});}
if(url.pathname==='/api/health')return json(res,200,{ok:true,server:'synthetic',tables:[],tableCount:0});
if(url.pathname==='/api/notifications/overview')return json(res,200,{ok:true,items:[],stats:{high:0,medium:0,low:0}});
if(url.pathname==='/api/audit/recent')return json(res,200,{ok:true,entries:[]});
if(url.pathname==='/api/volunteer/workflow/sources'&&process.env.PREVIEW_SOURCE_DELAY_MS)await new Promise(resolve=>setTimeout(resolve,Number(process.env.PREVIEW_SOURCE_DELAY_MS)));
const ctx={getDirectory:async()=>[...demoPeople,{accountId:'synthetic-organizer',role:'platform_admin',realName:'活动负责人（合成）'},{accountId:'synthetic-reviewer',role:'platform_admin',realName:'审核人（合成）'}],getResultMailStatus:mockMailStatuses,sendResultMail:mockSendResultMail,json,requireConsoleAccess:()=>signedIn?session:null,requirePortalSession:()=>signedIn?session:null,requireCsrf:(_req,response)=>{if(_req.headers['x-csrf-token']===session.csrf)return true;json(response,403,{ok:false,code:'csrf_failed'});return false;},getWorkflow:async()=>workflow,getAccount:async()=>account,actor:()=>session.username,audit:async()=>{},readJson:async request=>{let body='';for await(const chunk of request)body+=chunk;return JSON.parse(body||'{}');}};
const handled=await workflowRoutes(req,res,url,ctx);if(handled!==false)return handled;
if(url.pathname.startsWith('/api/'))return json(res,404,{ok:false,message:'合成界面测试不提供此接口'});await staticFile(req,res,url);
}catch(error){const f=apiFailure(error);json(res,f.status,f.payload);}});
const previewPort=Number(process.env.PORT||3121);
server.listen(previewPort,'127.0.0.1',()=>console.log(`Synthetic workflow UI: http://127.0.0.1:${previewPort}/console/events (no external writes)`));
