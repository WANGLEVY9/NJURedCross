import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflow,WF,WORKFLOW_SCHEMA,workflowApprovalHash} from '../lib/events/workflow.js';
import {REGISTRATION_COLUMNS,REGISTRATION_LINKS,REGISTRATION_TABLE,typedCell,normalizeRegistration,createRegistrationWriter} from '../lib/events/registration-schema.js';
import {columnData,migrationPlan,migrationRows,EVENT_TAXONOMY_COLUMNS} from '../lib/events/registration-migration.js';
import {registrationLinkTargets} from '../lib/events/registration-links.js';
import {projectWorkflowEvents} from '../lib/events/public-workflow.js';
import {registrationParticipant,certificateStatus} from '../public/app/shared/registration-profile.js';
const person={accountId:'synthetic-person',studentId:'999990001',realName:'合成同学',email:'999990001@smail.nju.edu.cn',emailVerified:true,campus:'仙林',department:'医学院',grade:'26本'};
const draft={name:'合成原生类型活动',date:'2030-10-12',slot:'08:30-10:30',position:'合成新岗位',capacity:2,serviceHours:2,trainingHours:0,travelHours:0,location:'苏州合成场地',work:'合成引导工作',center:'一加助残',region:'苏州活动'};
function fixture(){
 let seq=0;const rows=Object.fromEntries(Object.values(WF).map(t=>[t,[]]));
 const metadata={tables:WORKFLOW_SCHEMA.map((t,i)=>({name:t.name,_id:`t${i}`,columns:t.name===REGISTRATION_TABLE?REGISTRATION_COLUMNS.map((c,i)=>({...c,key:`c${i}`,data:c.type==='single-select'?columnData(c,null):c.data||null})):t.columns.map((name,i)=>({name,key:`c${i}`,type:'text'}))}))};
 const reg=metadata.tables.find(t=>t.name===REGISTRATION_TABLE);
 for(const l of REGISTRATION_LINKS){const target=metadata.tables.find(t=>t.name===l.target);reg.columns.push({name:l.name,type:'link',data:{link_id:`link-${l.name}`,table_id:reg._id,other_table_id:target._id}});}
 metadata.tables.find(t=>t.name===WF.events).columns.push(...EVENT_TAXONOMY_COLUMNS.map(c=>({...c,data:columnData(c,null)})));
 function native(table,patch){
  const result={};
  for(const [key,v]of Object.entries(patch)){
   const c=metadata.tables.find(t=>t.name===table).columns.find(c=>c.name===key);assert.ok(c,`known ${key}`);
   if(c.type==='checkbox')assert.equal(typeof v,'boolean');
   if(c.type==='number'&&v!==null)assert.equal(typeof v,'number');
   if(c.type==='single-select'&&v!==null)assert.ok(c.data.options.some(o=>o.name===v&&o.id),`configured ${key}: ${v}`);
   result[key]=c.type==='date'&&v&&v.length>10?new Date(Math.floor(Date.parse(v)/60000)*60000).toISOString():c.type==='long-text'?v?.text||null:v;
  }
  return result;
 }
 const base={async getMetadata(){return metadata;},async listRows(t,_v,_o,_c,start=0,n=500){return structuredClone(rows[t].slice(start,start+n));},async appendRow(t,p){const row={...native(t,p),_id:`r${++seq}`};rows[t].push(row);return {_id:row._id};},async updateRow(t,id,p){Object.assign(rows[t].find(r=>r._id===id),native(t,p));},async addColumnOptions(t,name,options){const c=metadata.tables.find(table=>table.name===t).columns.find(c=>c.name===name);for(const o of options)if(!c.data.options.some(x=>x.name===o.name))c.data.options.push({...o,id:`o${++seq}`});},async updateLink(id,t,target,rowId,ids){const col=metadata.tables.find(x=>x.name===t).columns.find(c=>c.data?.link_id===id);rows[t].find(r=>r._id===rowId)[col.name]=ids.map(row_id=>({row_id}));}};
 return {rows,metadata,base,w:createWorkflow(base)};
}
test('typed cells preserve zero versus missing, checkbox false and valid dates',()=>{
 assert.equal(typedCell({name:'志愿时长',type:'number'},''),null);assert.equal(typedCell({name:'志愿时长',type:'number'},'0'),0);
 assert.equal(typedCell({name:'是否报名成功',type:'checkbox'},'false'),false);
 for(const v of ['NaN','-1','100001'])assert.throws(()=>typedCell({name:'志愿时长',type:'number'},v));
 assert.throws(()=>typedCell({name:'报名日期',type:'date'},'2030-02-30'));assert.throws(()=>typedCell({name:'报名日期',type:'date'},'2030-10-12bad'));
 assert.throws(()=>typedCell({name:'创建时间',type:'date'},'2030-10-12T12:00:00'));
 const row={是否报名成功:true,志愿时长:0,处理说明:{text:'合成备注'},签到提交时间:'2030-10-12T12:30:00Z',签到提交时间原值:'2030-10-12T12:30:49.198Z'};
 assert.equal(normalizeRegistration(row).签到提交时间,row.签到提交时间原值);
 assert.equal(normalizeRegistration({...row,签到提交时间:'2030-10-12T12:31:00Z'}).签到提交时间,'2030-10-12T12:31:00.000Z');
 assert.equal(normalizeRegistration(row).志愿时长,'0');assert.equal(normalizeRegistration(row).处理说明,'合成备注');
});
test('new activity, enrolment, leave, attendance, hours and links roundtrip native types',async()=>{
 const f=fixture(),e=await f.w.create(draft,'owner');await f.w.approve(e._id,'reviewer');await f.w.publish(e._id);
 assert.equal(f.rows[WF.events][0].组织类别,'一加助残');
 const r=await f.w.register(e._id,person),native=f.rows[WF.registrations][0];
 assert.equal(native.是否报名成功,false);assert.equal(native.志愿时长,null);assert.equal(native.活动类别,'一加助残');assert.equal(native.校区,'仙林校区');assert.equal(native.地区,'苏州地区');assert.ok(native.创建时间原值);
 assert.equal(native['活动名称2'][0].row_id,e._id);
 await f.w.confirm(r._id);assert.equal(native.是否报名成功,true);
 await f.w.requestLeave(r.报名ID,person,'合成请假');assert.equal(native.请假状态,'待审批');await f.w.decideLeave(r._id,false,'合成驳回');
 await f.w.checkin(r._id,'checker','合成到场');assert.equal(native.报名状态,'已签到');assert.ok(native.签到表.length);
 const ledger=await f.w.reviewHours(r._id,'checker');await f.w.approveHours(ledger._id,'reviewer','platform_admin',ledger.核对摘要);await f.w.post(ledger._id);
 assert.equal(native.志愿时长,2);assert.equal(native.录入状态,'网站已入账');assert.ok(native.时长明细.length);assert.ok(native.个人主页.length);
 // Direct NJUTable cell changes are visible on the next authoritative read.
 native.备注='底表更新';assert.equal((await f.w.read()).registrations[0].备注,'底表更新');
 const eventRow=f.rows[WF.events][0],hash=workflowApprovalHash(eventRow);eventRow.组织类别='生命中心';
 assert.equal(workflowApprovalHash(eventRow),hash);assert.equal(projectWorkflowEvents((await f.w.publicRead()).events,[])[0].center,'生命中心');
});
test('migration uses original categories, validates rows, preserves timestamps and does not fabricate hours',()=>{
 const f=fixture(),e={_id:'event',活动ID:'WF-old',活动类别:'志愿服务',地点:'仙林',报名页配置:JSON.stringify({center:'生命类'})};
 const old={_id:'old',活动ID:e.活动ID,活动类别:'志愿服务',志愿时长:'',是否报名成功:'true',报名日期:'2030-10-12',报名状态:'已确认',创建时间:'2030-10-12T11:30:49.123Z'};
 const converted=migrationRows([old],[e])[0].values;
 assert.equal(converted.活动类别,'生命中心');assert.equal(converted.活动类型,'志愿服务');assert.equal(converted.志愿时长,null);assert.equal(converted.创建时间原值,old.创建时间);
 const legacy={name:'活动报名总表',columns:[{name:'岗位',data:{options:[{name:'陪跑志愿者',id:'111111',color:'#FFD9C8'},{name:'999990001',id:'222222'}]}}]};
 const options=columnData({name:'岗位',type:'single-select',options:[]},legacy,[{岗位:'合成新岗位'}]).options;
 assert.deepEqual(options.map(o=>o.name),['陪跑志愿者','合成新岗位']);assert.ok(options.every(o=>o.id));
 f.metadata.tables.push(legacy);f.metadata.tables.find(t=>t.name===REGISTRATION_TABLE).columns.find(c=>c.name==='活动类别').type='text';assert.equal(migrationPlan(f.metadata,[old],[e]).legacyTableWrites,0);
 assert.throws(()=>migrationRows([{...old,活动ID:'missing'}],[e]));
});
test('foreign typed columns fail closed and automatic/reverse-link columns are never stringified',async()=>{
 const f=fixture(),writer=createRegistrationWriter(f.base);f.metadata.tables.find(t=>t.name===REGISTRATION_TABLE).columns.find(c=>c.name==='志愿时长').type='date';
 await assert.rejects(writer.encode({志愿时长:2}),{code:'registration_schema_conflict'});
 f.metadata.tables.find(t=>t.name===WF.ledger).columns.push({name:'反向关联',type:'link'});
 assert.deepEqual(await writer.encodeTable(WF.ledger,{学号:'999990001',反向关联:[{row_id:'other'}]}),{学号:'999990001'});
 assert.throws(()=>registrationLinkTargets({_id:'x',签到行ID:'foreign',账号ID:'a',学号:'1',姓名:'合成'},{checkins:[]}));
});
test('migration is idempotent and exact profile enrichment never overwrites identity or intentional clears',()=>{
 const event={活动ID:'WF-old',活动类别:'志愿服务',组织类别:'主席团',地点:'仙林',报名页配置:'{}'};
 const row={_id:'r',活动ID:'WF-old',活动类别:'志愿服务',学号:'999990001',姓名:'合成同学',邮箱:'old@example.invalid',校区:'鼓楼',院系:'历史院系',志愿时长:'0'};
 const profile={学号:row.学号,姓名:row.姓名,年级:'26本',手机号:'10000000000',急救证:'是，AHA证书'};
 const first=migrationRows([row],[event],[profile])[0].values;
 assert.equal(first.活动类别,'主席团');assert.equal(first.年级,'26本');assert.equal(first.校区,'鼓楼校区');assert.equal(first.院系,'历史院系');assert.equal(first.邮箱,row.邮箱);assert.equal(first.志愿时长,0);
 const edited={...first,_id:'r',活动类别:'博爱中心',电话:'',地点:'底表修订'};
 const repeated=migrationRows([edited],[event],[profile],{legacyCategory:false})[0].values;
 assert.equal(repeated.活动类别,'博爱中心');assert.equal(repeated.电话,'');assert.equal(repeated.地点,'底表修订');assert.equal(repeated.志愿时长,0);
 assert.equal(migrationRows([row],[event],[profile,profile])[0].values.年级,undefined);
 assert.equal(migrationRows([row],[event],[{...profile,姓名:'其他同学'}])[0].values.电话,undefined);
});
test('booking profile changes override directory supplements without granting permissions',()=>{
 const profile={phone:'old',certificate:'是，AHA证书',certificateStatus:'yes',coreMemberStatus:'unknown'};
 const actual=registrationParticipant({电话:'new',年级:'26本',急救证:'未知'},profile);
 assert.equal(actual.phone,'new');assert.equal(actual.grade,'26本');assert.equal(actual.certificateStatus,'unknown');assert.equal(actual.coreMemberStatus,'unknown');assert.equal(profile.phone,'old');
 assert.equal(certificateStatus('否，但参加过“一加·急救培训”'),'no');assert.equal(certificateStatus('是，红十字CPR+AED/初级救护员/救护员'),'yes');
});
