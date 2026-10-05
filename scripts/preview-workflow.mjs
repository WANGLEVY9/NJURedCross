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
const workflow=createWorkflow(base,{now:()=>clock});const account={accountId:'synthetic-ui',studentId:'999990001',realName:'合成测试同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
const e=await workflow.create({name:'工位值班（合成界面测试）',date:'2026-10-04',slot:'上午',position:'现场服务岗',capacity:3,serviceHours:2,trainingHours:0.5,travelHours:1,location:'合成测试地点',work:'协助现场引导与签到核验'},'synthetic-organizer');await workflow.approve(e._id,'synthetic-reviewer');await workflow.publish(e._id);const r=await workflow.register(e._id,account);await workflow.confirm(r._id);await workflow.checkin(r._id,'synthetic-checker','合成到场核验');const l=await workflow.reviewHours(r._id,'synthetic-hour-checker');await workflow.approveHours(l._id,'synthetic-reviewer');await workflow.post(l._id);
const blood=await workflow.prepareBloodWeek({monday:'2026-10-05',week:45,capacity:1,serviceHours:2},'synthetic-organizer');const b=blood.events[0];await workflow.approve(b._id,'synthetic-reviewer');await workflow.publish(b._id);const br=await workflow.register(b._id,account);await workflow.confirm(br._id);clock=Date.parse('2026-10-05T11:15:00+08:00');
const serviceDemo=await workflow.create({name:'校园急救知识宣传 · 签到与时长演示',date:'2026-10-05',slot:'14:00–17:00',position:'宣传服务岗',capacity:12,serviceHours:3,trainingHours:1,travelHours:1,location:'南京大学仙林校区 · 学生活动中心',work:'协助急救知识宣传、现场引导和物料整理'},'synthetic-organizer');
await workflow.approve(serviceDemo._id,'synthetic-reviewer');await workflow.publish(serviceDemo._id);
for(let index=1;index<=8;index++){
 const sid=`99999100${index}`;
 const registration=await workflow.register(serviceDemo._id,{accountId:`synthetic-service-${index}`,studentId:sid,realName:`测试志愿者${String(index).padStart(2,'0')}`,department:index%2?'测试文学院':'测试医学院',email:`${sid}@smail.nju.edu.cn`,emailVerified:true});
 await workflow.confirm(registration._id);
 if(index>=4){const result=await workflow.attendanceBatch(serviceDemo._id,[{id:registration._id,hours:{serviceHours:index===5?2.5:3,trainingHours:1,travelHours:index===6?0:1,work:'急救知识宣传与现场引导'}}],'synthetic-organizer');const entry=result.results[0].result;
  if(index===6)await workflow.returnHours(entry._id,'synthetic-reviewer','platform_admin','请核对交通时长与实际工作内容',entry['核对摘要']);
  if(index>=7)await workflow.approveHours(entry._id,'synthetic-reviewer');
 }
}
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
const ctx={json,requireConsoleAccess:()=>signedIn?session:null,requirePortalSession:()=>signedIn?session:null,requireCsrf:(_req,response)=>{if(_req.headers['x-csrf-token']===session.csrf)return true;json(response,403,{ok:false,code:'csrf_failed'});return false;},getWorkflow:async()=>workflow,getAccount:async()=>account,actor:()=>session.username,audit:async()=>{},readJson:async request=>{let body='';for await(const chunk of request)body+=chunk;return JSON.parse(body||'{}');}};
const handled=await workflowRoutes(req,res,url,ctx);if(handled!==false)return handled;
if(url.pathname.startsWith('/api/'))return json(res,404,{ok:false,message:'合成界面测试不提供此接口'});await staticFile(req,res,url);
}catch(error){const f=apiFailure(error);json(res,f.status,f.payload);}});
server.listen(Number(process.env.PORT||3121),'127.0.0.1',()=>console.log(`Synthetic workflow UI: http://127.0.0.1:${process.env.PORT||3121}/console/workflow?event=${serviceDemo._id} (no external writes)`));
