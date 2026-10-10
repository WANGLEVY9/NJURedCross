import {quoteRoutes,QUOTE_TABLE,QUOTE_COLUMNS} from '../lib/community/quotes.js';
/** Isolated browser QA: synthetic in-memory rows; no .env, SMTP or SeaTable. */
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {BLOOD_SOURCE_TABLE} from '../lib/events/blood-source.js';
import {workflowRoutes} from '../lib/events/workflow-api.js';
import {json} from '../lib/http/response.js';
import {apiFailure} from '../lib/http/errors.js';
import {createStaticHandler} from '../lib/http/static.js';
import {readFile} from 'node:fs/promises';
let seq=0;const rows=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));
const base={async getMetadata(){return{tables:Object.keys(rows).map(name=>({name,columns:name===QUOTE_TABLE?QUOTE_COLUMNS.map(name=>({name,type:'text'})):[]}))};},async listRows(t,_v,_o,_c,s=0,n=500){return structuredClone(rows[t].slice(s,s+n));},async appendRow(t,row){const r={...row,_id:`synthetic-${++seq}`};rows[t].push(r);return {_id:r._id};},async updateRow(t,id,patch){Object.assign(rows[t].find(r=>r._id===id),patch);}};
rows['活动报名总表']=[{_id:'legacy1',活动类别:'志愿服务',活动名称:'校园生命教育宣传',报名日期:'2026-10-10',报名时段:'下午',岗位:'宣传岗',姓名:'仅合成',学号:'999990003'}];rows['登记审批']=[{_id:'app1',活动名称:'秋季急救培训',活动类别:'急救培训',活动日期:'2026-10-12'}];
rows['市血液献血车排班表（模板表）']=[{_id:'template',序号:'周一',点位:'新街口中央',活动时间:'上午 11~15点'}];
rows['个人主页（编辑版）']=[];rows['活动签到']=[];
let clock=Date.parse('2026-10-04T12:00:00+08:00');
rows[BLOOD_SOURCE_TABLE]=Array.from({length:7},(_,day)=>['新街口中央|上午 11~15点','新街口中央|下午 14~18点','新街口印象汇|上午 10~14点','新街口印象汇|下午 13~17点','仙林学则路|下午 14~18点','浦口弘阳广场|上午 11~15点','浦口弘阳广场|下午 15~19点'].map((text,i)=>{const [point,slot]=text.split('|');return {_id:`source-${day}-${i}`,日期:`2026-10-${12+day}`,点位:point,活动时间:slot,周次:46};})).flat();
const workflow=createWorkflow(base,{now:()=>clock,bloodSourceTable:BLOOD_SOURCE_TABLE});const account={accountId:'synthetic-ui',studentId:'999990001',realName:'合成测试同学',email:'999990001@smail.nju.edu.cn',emailVerified:true};
const e=await workflow.create({name:'工位值班（合成界面测试）',date:'2026-10-04',slot:'上午',position:'现场服务岗',capacity:3,serviceHours:2,trainingHours:0.5,travelHours:1,location:'合成测试地点',work:'协助现场引导与签到核验'},'synthetic-organizer');await workflow.approve(e._id,'synthetic-reviewer');await workflow.publish(e._id);const r=await workflow.register(e._id,account);await workflow.confirm(r._id);await workflow.checkin(r._id,'synthetic-checker','合成到场核验');const l=await workflow.reviewHours(r._id,'synthetic-hour-checker');await workflow.approveHours(l._id,'synthetic-reviewer');await workflow.post(l._id);
const b=(await workflow.publicRead()).events.find(e=>e['活动ID'].startsWith('BS-')&&e['地点']==='新街口中央');const br=await workflow.register(b._id,account);await workflow.confirm(br._id);clock=Date.parse('2026-10-12T11:15:00+08:00');
const demoDate=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
clock=Date.parse(`${demoDate}T09:00:00+08:00`);
const serviceDemo=await workflow.create({name:'校园急救知识宣传 · 签到与时长演示',date:demoDate,slot:'14:00–17:00',position:'宣传服务岗',capacity:40,serviceHours:3,trainingHours:1,travelHours:1,location:'南京大学仙林校区 · 学生活动中心',work:'协助急救知识宣传、现场引导和物料整理'},'synthetic-organizer');
await workflow.approve(serviceDemo._id,'synthetic-reviewer');await workflow.publish(serviceDemo._id);
// All identities are invented. Independent permutations make the three UI sorts visibly different.
// Seed 10 unchecked, 8 awaiting review, 4 returned, 6 approved and 2 posted records.
const demoNames=['周宁','陈悦','王澄','李禾','赵安','林晓','张予','孙晴','吴桐','许言','郑然','何舟','沈星','高远','徐知','黄溪','罗辰','朱雨','梁夏','唐月','宋清','谢初','韩青','冯一','邓嘉','曹乐','彭可','曾明','白羽','杜秋'];
const demoDepartments=['模拟文学院','模拟医学院','模拟计算机学院','模拟商学院','模拟外国语学院','模拟物理学院'];
const demoWork=['急救知识讲解与现场答疑','签到引导与秩序维护','宣传物料发放与回收','体验区协助与活动后整理'];
const returnReasons=['请核对实际离场时间，按实际服务时长修改。','请确认是否参加培训，核实培训时长。','请核对交通时长，本次为校内活动。','工作内容过于笼统，请补充实际承担的工作。'];
for(let index=0;index<demoNames.length;index++){
 const sid=String(999991000+(index*11+7)%30+1);
 clock=Date.parse(`${demoDate}T10:00:00+08:00`)+((index*7+11)%30)*3*60_000;
 const registration=await workflow.register(serviceDemo._id,{accountId:`synthetic-service-${index}`,studentId:sid,realName:`模拟·${demoNames[index]}`,department:demoDepartments[index%demoDepartments.length],email:`${sid}@smail.nju.edu.cn`,emailVerified:true});
 // Creation timestamps use wall time in the workflow; seed the in-memory fixture explicitly.
 await base.updateRow(WF.registrations,registration._id,{创建时间:new Date(clock).toISOString()});
 await workflow.confirm(registration._id);
 if(index%6!==5)rows['个人主页（编辑版）'].push({_id:`member-${index}`,学号:sid,姓名:registration['姓名'],部门:['博爱','生命中心主任团','综事','志愿者','苏州'][index%6],急救证:index%2?'有':'无'});
 if(index===1||index===2)await base.updateRow(WF.registrations,registration._id,{签到照片ID:'00000000-0000-4000-8000-000000000001',签到提交时间:`${demoDate}T06:05:00.000Z`});
 if(index===0){rows['活动报名总表'].push({_id:'demo-legacy-registration',活动名称:serviceDemo['活动名称'],活动类别:serviceDemo['活动类别'],报名日期:demoDate,报名时段:serviceDemo['报名时段'],岗位:serviceDemo['岗位'],姓名:registration['姓名'],学号:sid,签到表:[{row_id:'demo-legacy-checkin'}]});rows['活动签到'].push({_id:'demo-legacy-checkin',姓名:registration['姓名'],学号:sid,活动名称:[{row_id:'demo-legacy-registration'}],活动时间:`${demoDate}T06:00:00.000Z`,创建时间:`${demoDate}T06:03:00.000Z`,备注:'模拟旧签到表记录：现场签到，供关联演示。',已核对并录入:'未核对'});}
 if(index>=10){
  clock=Date.parse(`${demoDate}T14:00:00+08:00`)+index*60_000;
  const result=await workflow.attendanceBatch(serviceDemo._id,[{id:registration._id,hours:{serviceHours:[3,2.5,2,1.5][index%4],trainingHours:[0,0.5,1][index%3],travelHours:index%2?0.5:0,work:demoWork[index%4]}}],'synthetic-organizer');
  if(result.failed)throw new Error(`Synthetic attendance seed failed: ${result.results[0].message}`);
  const entry=result.results[0].result;
  if(index>=18&&index<22)await workflow.returnHours(entry._id,'synthetic-reviewer','platform_admin',returnReasons[index-18],entry['核对摘要']);
  if(index>=22)await workflow.approveHours(entry._id,'synthetic-reviewer');
  if(index>=28)await workflow.post(entry._id);
 }
}
rows[QUOTE_TABLE]=[{_id:'synthetic-quote',内容:'合成测试寄语：每一次行动，都让善意更近一步。',署名:'合成测试',来源:'仅用于界面测试',状态:'已发布',更新时间:'2026-10-09T00:00:00Z'}];
// Repeat participation demonstrates monthly aggregation without changing live NJUTable rows.
clock=Date.parse('2026-10-04T09:00:00+08:00');
const monthEvents=(await workflow.overview()).events.filter(e=>e._id.startsWith('BS-'));
let monthlyDemo;
for(let i=0;i<4;i++){
 const event=monthEvents.find(e=>e['报名日期']===`2026-10-${12+i}`&&e['地点']===(i%2?'新街口中央':'新街口印象汇')&&e['报名时段'].startsWith('上午'));
 monthlyDemo ||= event;
 const student={accountId:'synthetic-monthly',studentId:'999992001',realName:'模拟·月度志愿者',department:'模拟文学院',email:'999992001@smail.nju.edu.cn',emailVerified:true};
 const r=await workflow.register(event._id,student);await workflow.confirm(r._id);
 await base.updateRow(WF.registrations,r._id,{签到照片ID:'00000000-0000-4000-8000-000000000001',签到提交时间:`2026-10-${12+i}T03:05:00Z`});
 const result=await workflow.attendanceBatch(event._id,[{id:r._id,hours:{serviceHours:[4,4.5,0,3][i],trainingHours:1,travelHours:1,work:'献血车志愿者'}}],'synthetic-organizer');
 if(result.failed)throw Error(result.results[0].message);
}
rows['个人主页（编辑版）'].push({_id:'monthly-member',学号:'999992001',姓名:'模拟·月度志愿者',部门:'生命',急救证:'有'});
// Extra monthly examples: identities, service dates, review states and ordering vary independently.
const monthlyExamples=[
 {name:'陈悦',sid:'999992019',hours:[3,4,2.5],department:'生命',state:'pending'},
 {name:'王澄',sid:'999992005',hours:[4,4],department:'综事',state:'approved'},
 {name:'孙晴',sid:'999992012',hours:[2.5,3.5],department:'志愿者',state:'pending'},
 {name:'周宁',sid:'999992008',hours:[4,2,3],department:'博爱',state:'mixed'},
 {name:'李禾',sid:'999992025',hours:[3],department:'生命中心主任团',state:'returned'},
 {name:'林晓',sid:'999992003',hours:[4,3],department:'志愿者',state:'pending'},
 {name:'林晓',sid:'999992027',hours:[2,4.5],department:'苏州',state:'approved'},
 {name:'许言',sid:'999992014',hours:[0],department:'',state:'pending'},
];
const occupiedMonthly=new Set(rows[WF.registrations].map(r=>r['活动ID']));
for(const [index,example] of monthlyExamples.entries()){
 const dates=new Set();
 for(const [occurrence,hours] of example.hours.entries()){
  const targetDate=`2026-10-${12+(index+occurrence*2)%7}`;
  const available=monthEvents.filter(e=>!occupiedMonthly.has(e['活动ID'])&&!dates.has(e['报名日期']));
  const event=available.find(e=>e['报名日期']===targetDate)||available[0];
  if(!event)throw Error('Not enough distinct synthetic shifts for monthly examples');
  occupiedMonthly.add(event['活动ID']);dates.add(event['报名日期']);
  const student={accountId:`synthetic-monthly-extra-${index}`,studentId:example.sid,realName:`模拟·${example.name}`,department:demoDepartments[index%demoDepartments.length],email:`${example.sid}@smail.nju.edu.cn`,emailVerified:true};
  const registration=await workflow.register(event._id,student);await workflow.confirm(registration._id);
  await base.updateRow(WF.registrations,registration._id,{创建时间:new Date(Date.parse('2026-10-04T09:00:00+08:00')+((index*3)%8)*3600000+occurrence*60000).toISOString(),签到照片ID:'00000000-0000-4000-8000-000000000001',签到提交时间:`${event['报名日期']}T08:05:00Z`});
  const result=await workflow.attendanceBatch(event._id,[{id:registration._id,hours:{serviceHours:hours,trainingHours:occurrence%2?0.5:1,travelHours:index%3===0?0.5:1,work:['献血登记与现场引导','献血知识宣传与咨询答疑','服务物料整理与秩序维护'][occurrence%3],remark:hours===0?'模拟：本次未实际服务，不计入导出':example.name==='林晓'?'模拟：同名但学号不同的两位同学':''}}],'synthetic-organizer');
  if(result.failed)throw Error(result.results[0].message);
  const entry=result.results[0].result;
  if(example.state==='approved'||example.state==='mixed'&&occurrence===0)await workflow.approveHours(entry._id,'synthetic-reviewer');
  if(example.state==='returned')await workflow.returnHours(entry._id,'synthetic-reviewer','platform_admin','模拟：请核对实际离场时间后重新提交。',entry['核对摘要']);
 }
 if(example.department)rows['个人主页（编辑版）'].push({_id:`monthly-extra-member-${index}`,学号:example.sid,姓名:`模拟·${example.name}`,部门:example.department,急救证:index%2?'有':'无'});
}
// UI-only multi-person attendance fixture for the selected monthly shift. Direct in-memory
// seeding deliberately bypasses the real one-person position limit; production rules stay intact.
for(const [index,name] of ['何舟','沈星','高远','郑然','黄溪','罗辰','朱雨'].entries()){
 const sid=String(999993001+index),photo=index!==3;
 const registration=await base.appendRow(WF.registrations,{活动ID:monthlyDemo['活动ID'],活动名称:monthlyDemo['活动名称'],活动类别:monthlyDemo['活动类别'],报名ID:`WR-synthetic-attendance-${index}`,账号ID:`synthetic-attendance-${index}`,姓名:`模拟·${name}`,学号:sid,邮箱:`${sid}@smail.nju.edu.cn`,院系:demoDepartments[index%demoDepartments.length],报名日期:monthlyDemo['报名日期'],报名时段:monthlyDemo['报名时段'],岗位:monthlyDemo['岗位'],报名状态:'已确认',是否报名成功:'true',录入状态:'网站待核对',创建时间:`2026-10-04T0${index}:00:00Z`,...(photo?{签到照片ID:'00000000-0000-4000-8000-000000000001',签到提交时间:'2026-10-12T02:05:00Z'}:{})});
 rows['个人主页（编辑版）'].push({_id:`attendance-member-${index}`,姓名:`模拟·${name}`,学号:sid,部门:['生命','博爱','志愿者','综事'][index%4],急救证:index%2?'有':'无'});
 if(index>=4){
  const result=await workflow.attendanceBatch(monthlyDemo._id,[{id:registration._id,hours:{serviceHours:3,trainingHours:0.5,travelHours:1,work:'献血登记、现场引导与物料整理'}}],'synthetic-organizer');
  if(result.failed)throw Error(result.results[0].message);
  const entry=result.results[0].result;
  if(index===4)await workflow.returnHours(entry._id,'synthetic-reviewer','platform_admin','模拟：请核对实际离场时间。',entry['核对摘要']);
  if(index===6)await workflow.approveHours(entry._id,'synthetic-reviewer');
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
// A clearly labelled synthetic image; no student photo or external asset is used.
const demoPhoto=url.pathname.match(/^\/api\/volunteer\/workflow\/registrations\/([^/]+)\/photo$/);
if(req.method==='GET'&&demoPhoto&&signedIn&&rows[WF.registrations].some(r=>r._id===decodeURIComponent(demoPhoto[1])&&r['签到照片ID']==='00000000-0000-4000-8000-000000000001')){
 const bytes=await readFile(fileURLToPath(new URL('./fixtures/demo-attendance.png',import.meta.url)));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, no-store'});res.end(bytes);return;
}
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
if(url.pathname==='/api/notifications/overview')return json(res,200,{ok:true,items:[],stats:{total:0,high:0,medium:0,low:0}});
if(url.pathname==='/api/audit/recent')return json(res,200,{ok:true,entries:[]});
if(url.pathname==='/api/volunteer/workflow/sources'&&process.env.PREVIEW_SOURCE_DELAY_MS)await new Promise(resolve=>setTimeout(resolve,Number(process.env.PREVIEW_SOURCE_DELAY_MS)));
const ctx={json,requireConsoleAccess:()=>signedIn?session:null,requirePortalSession:()=>signedIn?session:null,requireCsrf:(_req,response)=>{if(_req.headers['x-csrf-token']===session.csrf)return true;json(response,403,{ok:false,code:'csrf_failed'});return false;},getWorkflow:async()=>workflow,getAccount:async()=>account,actor:()=>session.username,audit:async()=>{},readJson:async request=>{let body='';for await(const chunk of request)body+=chunk;return JSON.parse(body||'{}');}};
if(url.pathname==='/api/community/quotes'||url.pathname.startsWith('/api/community/quotes/')){if(!signedIn)return json(res,401,{ok:false});if(!previewPermissions.includes('community'))return json(res,403,{ok:false});if(req.method!=='GET'&&!ctx.requireCsrf(req,res))return;return await quoteRoutes(req,res,url,{base,session,json,readJson:ctx.readJson,audit:ctx.audit});}
const handled=await workflowRoutes(req,res,url,ctx);if(handled!==false)return handled;
if(url.pathname.startsWith('/api/'))return json(res,404,{ok:false,message:'合成界面测试不提供此接口'});await staticFile(req,res,url);
}catch(error){const f=apiFailure(error);json(res,f.status,f.payload);}});
server.listen(Number(process.env.PORT||3121),'127.0.0.1',()=>console.log(`Synthetic workflow UI: http://127.0.0.1:${process.env.PORT||3121}/console/workflow?event=${serviceDemo._id} (no external writes)\nMonthly review: http://127.0.0.1:${process.env.PORT||3121}/console/workflow?event=${monthlyDemo._id}&tab=hours`));
