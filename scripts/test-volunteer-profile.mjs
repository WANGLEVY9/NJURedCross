/** Synthetic in-memory fixtures only: no external requests or student writes. */
import assert from 'node:assert/strict';
import {identityRoutes} from '../lib/identity/api.js';
import { synchronizeProfile, profilePatch, PROFILE_FIELDS, validateProfileValues, PROFILE_TABLE } from '../lib/identity/volunteer-profile.js';
import { ACCOUNT_TABLE, accountFromRow } from '../lib/identity/store.js';
let checks=0;
function check(name,condition){assert.ok(condition,name);checks++;console.log(`PASS ${name}`);}
function fixture(extra={}) {
  const raw={_id:'account-row',账号ID:'ACC-SYNTHETIC',登录名:'239000001@smail.nju.edu.cn',邮箱:'239000001@smail.nju.edu.cn',密码哈希:'synthetic-hash',角色:'member',真实姓名:'模拟同学',学号:'239000001',邮箱已验证:'已验证',...extra};
  const binding={_id:'binding',账号ID:raw['账号ID']};let next=1,fail=false;
  const rows=[{_id:'volunteer-row',学号:'239000001',姓名:'模拟同学',院系:'软件学院',年级:'23本',性别:'女',校区:'鼓楼',手机号:13800000000,邮箱:'synthetic@example.test',微信:'synthetic',QQ:'12345678',部门:'志愿者',急救证:'否',总志愿时长:12}];
  const bindings=[binding];const writes=[];
  const client={listRows:async(table,_v,_o,_c,start=0,limit=100)=>structuredClone((table===ACCOUNT_TABLE?[raw]:bindings).slice(start,start+limit)),updateRow:async(table,id,patch)=>Object.assign(table===ACCOUNT_TABLE?raw:bindings.find(b=>b._id===id),patch)};
  const source={dtableUuid:'test-profile',getMetadata:async()=>({tables:[{name:PROFILE_TABLE,columns:['学号','姓名',...Object.values(PROFILE_FIELDS)].map(name=>({name,type:['院系','年级','性别','校区'].includes(name)?'single-select':'text',data:{options:({'院系':['软件学院'],'年级':['23本'],'性别':['男','女'],'校区':['鼓楼','仙林']}[name]||[]).map(name=>({name}))}}))}]}),
    query:async sql=>{assert.match(sql,/WHERE `学号` = '239000001' LIMIT 3/);return structuredClone(rows);},
    appendRow:async(table,patch)=>{if(fail)throw Error('synthetic failure');const row={_id:'created-'+next++,...patch};rows.push(row);writes.push({append:patch});return {_id:row._id};},
    updateRow:async(table,id,patch)=>{if(fail)throw Error('synthetic failure');writes.push(patch);Object.assign(rows.find(r=>r._id===id),patch);}};
  const ctx={getProfileBase:async()=>source,config:{profileBaseUuid:'test-profile'}};
  return {raw,binding,rows,bindings,writes,client,ctx,account:()=>accountFromRow(raw),fail:v=>{fail=v;},sync:()=>synchronizeProfile(client,ctx,accountFromRow(raw))};
}
let f=fixture(),r=await f.sync();
check('exact verified identity imports profile',r.state==='已同步'&&r.account.department==='软件学院'&&r.account.contactEmail==='synthetic@example.test');
check('fixed mapping stored privately',f.binding['资料行ID']==='volunteer-row'&&f.binding['资料BaseUUID']==='test-profile');
check('import never writes source or changes authentication',f.writes.length===0&&f.raw['密码哈希']==='synthetic-hash'&&r.account.email==='239000001@smail.nju.edu.cn');
check('managed data is read only',r.readonly.totalHours==='12'&&r.readonly.division==='志愿者');
f.rows[0]['院系']='其他学院';r=await f.sync();check('later source changes do not replace saved profile',r.account.department==='软件学院');
Object.assign(f.raw,profilePatch(f.raw,{phone:'13900000000',wechat:'changed',contactEmail:'',campus:'仙林'}));r=await f.sync();
check('user edits sync whitelist only',f.rows[0]['手机号']===13900000000&&f.rows[0]['校区']==='仙林'&&f.rows[0]['邮箱']===''&&f.rows[0]['总志愿时长']===12);
check('blank remains blank after reopening',(await f.sync()).account.contactEmail==='');
Object.assign(f.raw,profilePatch(f.raw,{phone:'13700000000'}));f.fail(true);r=await f.sync();
check('outage retains private save and durable pending',r.state==='待重试'&&r.account.phone==='13700000000'&&JSON.parse(f.raw['志愿资料']).pending.phone==='13700000000');
f.fail(false);r=await f.sync();check('retry is idempotent and clears pending',r.state==='已同步'&&f.rows[0]['手机号']===13700000000&&!JSON.parse(f.raw['志愿资料']).pending);
f=fixture({邮箱已验证:'未验证'});check('unverified account never reads or writes volunteer profile',(await f.sync()).state==='待核验'&&f.writes.length===0&&!f.binding['资料行ID']);
f=fixture({邮箱:'239000002@smail.nju.edu.cn'});check('student ID must match verified email',(await f.sync()).state==='待核验');
f=fixture();f.rows[0]['姓名']='其他同学';r=await f.sync();check('name mismatch reveals no source data',r.state==='需人工核验'&&r.account.department===''&&Object.keys(r.readonly).length===0&&f.writes.length===0);
f=fixture();f.rows.push({...f.rows[0],_id:'duplicate'});check('duplicate ID fails closed',(await f.sync()).state==='需人工核验'&&f.writes.length===0);
f=fixture();f.binding['资料行ID']='stale-row';check('stable binding cannot silently switch rows',(await f.sync()).state==='需人工核验');
f=fixture();f.bindings.push({_id:'other-binding',账号ID:'other',资料BaseUUID:'test-profile',资料行ID:'volunteer-row'});check('other account binding blocks takeover',(await f.sync()).state==='需人工核验');
f=fixture();f.binding['资料BaseUUID']='other-base';check('Base change requires manual review',(await f.sync()).state==='需人工核验');
f=fixture();f.rows.length=0;await Promise.all([f.sync(),f.sync()]);check('concurrent new signup creates one source row',f.rows.length===1&&f.writes.length===1);
check('privileged fields rejected',Boolean(validateProfileValues({role:'platform_admin'}))&&Boolean(validateProfileValues({studentId:'239000002'}))&&Boolean(validateProfileValues({totalHours:'999'})));
check('schema choices and contacts validated',Boolean(validateProfileValues({campus:'unknown'},{campus:['鼓楼']}))&&Boolean(validateProfileValues({phone:'12'}))&&Boolean(validateProfileValues({qq:'abc'}))&&Boolean(validateProfileValues({contactEmail:'invalid'})));
f=fixture({角色:'platform_admin',学号:''});r=await f.sync();check('verified administrator maps by mailbox without changing privileges or locked student ID',r.state==='已同步'&&r.account.role==='platform_admin'&&r.account.studentId==='');
check('mapping never serializes password hashes',!JSON.stringify({state:r.state,readonly:r.readonly}).includes('synthetic-hash'));
// Exercise the actual authenticated HTTP handler as well as the mapping helper.
f=fixture();
const apiCtx={...f.ctx,config:{...f.ctx.config,privateIdentity:true,businessBaseUuid:'test-business',volunteerBaseUuid:'test-readonly'},getBase:async()=>f.client,requireSession:()=>({username:f.account().username}),requireCsrf:()=>true,readJson:async req=>req.body,accounts:new Map(),recordAudit:async()=>{},json:(res,status,body)=>({status,body})};
async function patch(body){return identityRoutes({method:'PATCH',body,headers:{}},{},new URL('http://fixture/api/auth/account'),apiCtx);}
check('HTTP handler rejects source row and role overrides',(await patch({rowId:'other',role:'platform_admin'})).status===400);
check('HTTP handler rejects managed hours',(await patch({totalHours:'999'})).status===400);
check('HTTP handler rejects arbitrary source choices',(await patch({campus:'unknown'})).status===400);
let response=await patch({campus:'仙林',wechat:'updated'});
check('HTTP handler returns own saved and synced profile',response.status===200&&response.body.profileMapping.state==='已同步'&&response.body.account.campus==='仙林'&&f.rows[0]['微信']==='updated');
check('HTTP profile response has no credential or internal row ID',!JSON.stringify(response.body).includes('synthetic-hash')&&!JSON.stringify(response.body).includes('volunteer-row'));
apiCtx.getProfileBase=async()=>{throw Error('synthetic source unavailable');};
response=await patch({phone:'13600000000'});
check('HTTP handler preserves private save during full source outage',response.status===200&&response.body.profileMapping.state==='待重试'&&response.body.account.phone==='13600000000'&&JSON.parse(f.raw['志愿资料']).pending.phone==='13600000000');
apiCtx.getProfileBase=f.ctx.getProfileBase;response=await identityRoutes({method:'GET',headers:{}},{},new URL('http://fixture/api/auth/account'),apiCtx);
check('HTTP GET retries durable pending after source recovery',response.body.profileMapping.state==='已同步'&&f.rows[0]['手机号']===13600000000);
console.log(`Volunteer profile regression: ${checks}/${checks} passed; external writes: 0.`);
