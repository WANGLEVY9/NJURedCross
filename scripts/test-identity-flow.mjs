/** Offline regression suite: no network, SMTP, or production row writes. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BINDING_TABLE, identityRoutes } from '../lib/identity/api.js';
import { ACCOUNT_TABLE, CODE_TABLE, accountFromRow, canAuthenticate, credentialVersion, findAccountByLogin, resolveSignInAccount, hashPassword, verifyPassword, generateMemberCode, listIdentityRows } from '../lib/identity/store.js';
import { passwordPolicyError } from '../public/app/core/password-policy.js';
import { safePortalNext } from '../public/app/portal/auth-flow.js';
let checks=0;
function check(name,condition){assert.ok(condition,name);checks++;console.log(`PASS ${name}`);}
const tables=new Map([[ACCOUNT_TABLE,[]],[CODE_TABLE,[]],[BINDING_TABLE,[]]]);
const client={
  async listRows(table,_v,_o,_c,start=0,limit=100){return structuredClone((tables.get(table)||[]).slice(Number(start)||0,(Number(start)||0)+Number(limit)));},
  async appendRow(table,row){const r={_id:`row-${randomBytes(5).toString('hex')}`,...row};tables.get(table).push(r);return {_id:r._id};},
  async updateRow(table,id,patch){Object.assign(tables.get(table).find(r=>r._id===id),patch);},
};
let failMail=false,ip=0;
const mail=[];
const ctx={
  config:{registrationAvailable:true,minimumPasswordLength:8,privateIdentity:true,businessBaseUuid:'test-business',volunteerBaseUuid:'test-volunteer',smailDomains:['smail.nju.edu.cn','nju.edu.cn'],codeSecret:'offline-test-secret-never-used-in-production'},
  getBase:async()=>client,readJson:async req=>req.body,clientIp:req=>req.ip,identifier:p=>p+'-'+randomBytes(6).toString('hex'),
  json:(res,status,body,headers={})=>{const result={status,body,headers};if(res)res.result=result;return result;},recordAudit:async()=>{},accounts:new Map(),
  sendMail:async message=>{mail.push(message);return failMail?{ok:false}:{ok:true};},
  makeSession:a=>'token-'+a.username,getSession:()=>({username:'test'}),sessionPayload:()=>({ok:true,authenticated:true}),sessionCookie:t=>'cookie='+t,
};
const profiles=new Map();
async function call(path,body={},options={}){
  if(path==='/api/auth/register'){
    if(!profiles.has(body.email))profiles.set(body.email,{realName:'离线测试同学',studentId:/^[0-9]+$/.test(body.email?.split('@')[0]||'')?body.email.split('@')[0]:String(230000000+profiles.size)});
    body={...profiles.get(body.email),...body};
  }
  const res={};const result=await identityRoutes({method:options.method||'POST',headers:{host:'localhost',...options.headers},ip:options.ip||`test-${++ip}`,body},res,new URL(path,'http://localhost'),ctx);return result||res.result;}
const password='Abcd123!';
check('eight-character complex password accepted',!passwordPolicyError(password));
check('all four character classes required',['abcd123!','ABCD123!','Abcdefg!','Abcd1234','Abcd123 ','Ab12!xx', 'Ab12!'+'x'.repeat(68)].every(p=>passwordPolicyError(p)));
check('72-character maximum accepted',!passwordPolicyError('Ab12!'+'x'.repeat(67)));
function latest(email,purpose='register'){return tables.get(CODE_TABLE).filter(r=>r['邮箱']===email&&r['用途']===purpose).at(-1);}
function codeFor(email,purpose='register'){return mail.filter(m=>m.to===email&&m.kind==='verification'&&m.subject.includes(purpose==='reset'?'重置':'注册')).at(-1)?.text.match(/验证码是：(\d{6})/)[1];}
function ageCodes(email){for(const r of tables.get(CODE_TABLE))if(r['邮箱']===email)r['创建时间']=new Date(Date.now()-61000).toISOString();}
const email='231000001@smail.nju.edu.cn';
check('public registration configuration',(await call('/api/auth/registration-config',{}, {method:'GET'})).body.enabled);
ctx.config.registrationAvailable=false;
check('SMTP unavailable blocks signup without rows',(await call('/api/auth/register',{email,password})).status===503&&tables.get(ACCOUNT_TABLE).length===0);
ctx.config.registrationAvailable=true;
check('exact campus domain required',(await call('/api/auth/register',{email:'x@smail.nju.edu.cn.attacker.test',password})).status===400);
check('cross-origin registration denied',(await call('/api/auth/register',{email,password},{headers:{origin:'https://attacker.test'}})).status===403);
check('password policy enforced',(await call('/api/auth/register',{email,password:'short'})).status===400);
check('email prefix must match student ID',(await call('/api/auth/register',{email,password,studentId:'239000099'})).body.code==='student_email_mismatch');
check('real name required',(await call('/api/auth/register',{email,password,realName:''})).body.code==='invalid_profile');
check('student ID required',(await call('/api/auth/register',{email,password,studentId:''})).body.code==='invalid_profile');
let result=await call('/api/auth/register',{email,password,realName:'测试同学甲'});
profiles.get(email).realName='测试同学甲';
check('signup persists pending hash without returning code',result.status===201&&!('devCode' in result.body)&&!JSON.stringify(result.body).includes(password)&&!canAuthenticate(await findAccountByLogin(client,email)));
check('password stored as scrypt',verifyPassword(password,(await findAccountByLogin(client,email)).passwordHash));
check('persistent resend cooldown',(await call('/api/auth/email-codes',{email})).status===429);
check('wrong OTP rejected',(await call('/api/auth/verify-email',{email,code:codeFor(email)==='000000'?'111111':'000000',password})).status===401);
check('registration password also required',(await call('/api/auth/verify-email',{email,code:codeFor(email),password:'incorrect'})).body.code==='registration_password_mismatch');
const otp=codeFor(email);
result=await call('/api/auth/verify-email',{email,code:otp,password});
check('valid OTP and password activate and sign in',result.status===200&&canAuthenticate(await findAccountByLogin(client,email))&&result.body.memberCode.startsWith('RC-M-'));
check('verification replay rejected',(await call('/api/auth/verify-email',{email,code:otp,password})).status===409);
check('verified address cannot reregister',(await call('/api/auth/register',{email,password})).status===409);
const email2='231000002@smail.nju.edu.cn';
await call('/api/auth/register',{email:email2,password});let oldCode=codeFor(email2);ageCodes(email2);
await call('/api/auth/email-codes',{email:email2});
check('resend invalidates old challenge',tables.get(CODE_TABLE).filter(r=>r['邮箱']===email2)[0]['状态']==='已失效');
if(oldCode!==codeFor(email2))check('old OTP cannot verify',(await call('/api/auth/verify-email',{email:email2,code:oldCode,password})).status===401);
latest(email2)['过期时间']='not-a-date';
check('malformed expiry fails closed',(await call('/api/auth/verify-email',{email:email2,code:codeFor(email2),password})).body.code==='code_expired');
const email3='231000003@smail.nju.edu.cn';
await call('/api/auth/register',{email:email3,password});const code3=codeFor(email3);
for(let i=0;i<5;i++)await call('/api/auth/verify-email',{email:email3,code:code3==='999999'?'111111':'999999',password});
check('five wrong attempts permanently invalidate current OTP',latest(email3)['状态']==='已失效');
check('correct code after lockout fails',(await call('/api/auth/verify-email',{email:email3,code:code3,password})).status===400);
const email4='231000004@smail.nju.edu.cn';
const concurrent=await Promise.all([call('/api/auth/register',{email:email4,password}),call('/api/auth/register',{email:email4,password})]);
check('concurrent signup creates one account',concurrent.some(r=>r.status===201)&&concurrent.some(r=>r.status===429)&&tables.get(ACCOUNT_TABLE).filter(r=>r['邮箱']===email4).length===1);
const verified=await Promise.all([call('/api/auth/verify-email',{email:email4,code:codeFor(email4),password}),call('/api/auth/verify-email',{email:email4,code:codeFor(email4),password})]);
check('concurrent verification consumes OTP once',verified.filter(r=>r.status===200).length===1);
failMail=true;const failEmail='231000005@smail.nju.edu.cn';result=await call('/api/auth/register',{email:failEmail,password});
check('SMTP failure has recoverable pending signup',result.status===201&&result.body.deliveryStatus==='failed'&&!canAuthenticate(await findAccountByLogin(client,failEmail))&&latest(failEmail)['状态']==='已失效');
failMail=false;ageCodes(failEmail);await call('/api/auth/register',{email:failEmail,password});
check('pending signup retry creates no duplicate',tables.get(ACCOUNT_TABLE).filter(r=>r['邮箱']===failEmail).length===1);
check('student ID duplicate rejected',(await call('/api/auth/register',{email:'231000001@nju.edu.cn',password,studentId:profiles.get(email).studentId})).body.code==='student_id_in_use');
const crossEmail=await Promise.all([call('/api/auth/register',{email:'239999999@smail.nju.edu.cn',password,studentId:'239999999'}),call('/api/auth/register',{email:'239999999@nju.edu.cn',password,studentId:'239999999'})]);
check('different emails cannot concurrently claim same student ID',crossEmail.filter(r=>r.status===201).length===1&&crossEmail.filter(r=>r.body.code==='student_id_in_use').length===1);
check('profile persisted separately from display name',(await findAccountByLogin(client,email)).realName==='测试同学甲'&&(await findAccountByLogin(client,email)).studentId===profiles.get(email).studentId);
check('duplicate names are ambiguous',(await resolveSignInAccount(client,'离线测试同学')).ambiguous);
check('binding ties stable account ID to both Base references',tables.get(BINDING_TABLE).some(r=>r['账号ID']===tables.get(ACCOUNT_TABLE).find(a=>a['邮箱']===email)['账号ID']&&r['主业务BaseUUID']==='test-business'&&r['志愿者BaseUUID']==='test-volunteer'));
const derived=await call('/api/auth/register',{studentId:'239888888',realName:'后缀选择测试',password,emailDomain:'nju.edu.cn'});
check('registration derives mailbox from student ID and selected domain',derived.status===201&&derived.body.email==='239888888@nju.edu.cn');
check('invalid email suffix rejected',(await call('/api/auth/register',{studentId:'239777777',realName:'后缀测试',password,emailDomain:'attacker.test'})).status===400);
// Reset jobs return identical acknowledgments and run in the background.
ageCodes(email);
const resetKnown=await call('/api/auth/email-codes',{email,purpose:'reset'});
const resetUnknown=await call('/api/auth/email-codes',{email:'231000006@smail.nju.edu.cn',purpose:'reset'});
await new Promise(resolve=>setTimeout(resolve,30));
check('reset does not enumerate accounts',JSON.stringify(resetKnown)===JSON.stringify(resetUnknown));
const resetCode=codeFor(email,'reset');
check('register OTP cannot reset password',(await call('/api/auth/reset-password',{email,code:otp,password})).status===401);
check('reset enforces complexity before consuming valid code',(await call('/api/auth/reset-password',{email,code:resetCode,password:'abcd123!'})).body.code==='password_policy'&&latest(email,'reset')['状态']==='待使用');
const replacement='New1234!';
result=await call('/api/auth/reset-password',{email,code:resetCode,password:replacement});
check('reset changes password without automatic login',result.status===200&&!result.body.authenticated&&verifyPassword(replacement,(await findAccountByLogin(client,email)).passwordHash));
check('reset code single use',(await call('/api/auth/reset-password',{email,code:resetCode,password})).status===400);
const paged={listRows:async(_t,_v,_o,_c,start,limit)=>Array.from({length:650},(_,i)=>({_id:String(i)})).slice(start,start+limit)};
check('identity pagination reads past 500 rows',(await listIdentityRows(paged,ACCOUNT_TABLE)).length===650);
check('unsafe next paths rejected',['//evil.test','/\\evil.test','/%5cevil.test','/console/data'].every(p=>safePortalNext(p)==='/me'));
// Persisted hourly limits survive process-local state changes.
ageCodes(email3);
for(let i=0;i<4;i++)tables.get(CODE_TABLE).push({...latest(email3),_id:'extra-'+i,验证码ID:'extra-'+i,状态:'已失效'});
check('persistent five-per-hour email limit',(await call('/api/auth/email-codes',{email:email3})).status===429);
const disabledAccount=tables.get(ACCOUNT_TABLE).find(r=>r['邮箱']===email4);disabledAccount['状态']='停用';
check('disabled accounts cannot be reactivated by verification',(await call('/api/auth/verify-email',{email:email4,code:codeFor(email4),password})).status===400);
const beforeResetMails=mail.length;
await call('/api/auth/email-codes',{email:email4,purpose:'reset'});await new Promise(resolve=>setTimeout(resolve,20));
check('disabled account receives no reset message',mail.length===beforeResetMails);
let limited;
for(let i=0;i<21;i++)limited=await call('/api/auth/email-codes',{email:email3},{ip:'same-test-address'});
check('source address mail flood limit',limited.status===429&&limited.body.retryAfter===600);
// Execute the actual session/login functions without booting a server.
const source=await readFile(new URL('../server.js',import.meta.url),'utf8');
const sourceBlock=source.slice(source.indexOf('function hash(value)'),source.indexOf('const publicPrograms ='));
const runtime=await findAccountByLogin(client,email);
const box={createHash,createHmac,randomBytes,timingSafeEqual,sessionSecret:'test-session-secret',sessionTtlSeconds:3600,secureCookie:true,
  accountsByUsername:new Map([[runtime.username,runtime]]),revokedSessions:new Map(),loginAttempts:new Map(),
  canAuthenticate,credentialVersion,findAccountByLogin,resolveSignInAccount,verifyPassword,ACCOUNT_TABLE,
  isAccountActive:a=>!!a&&(!a.status||a.status==='启用'),hasPermission:()=>true,normalizePermissions:()=>[],
  consoleRoles:new Set(['platform_admin']),roleDefinitions:{member:{label:'member',surfaces:['portal']}},
  accountLoad:{source:'seatable:平台账号表'},getBase:async()=>client,getIdentityBase:async()=>client,readJson:async req=>req.body,recordAudit:async()=>{},
  json:(_res,status,body,headers={})=>({status,body,headers}),Date,Buffer,URL,Map,Set,console,
};
vm.createContext(box);vm.runInContext(sourceBlock,box);
const token=box.makeSession(runtime);const req={headers:{cookie:`nju_redcross_session=${token}`},socket:{remoteAddress:'127.0.0.1'}};
check('new business attribution uses stable account ID',box.businessAccountRef({username:runtime.username})===runtime.accountId&&runtime.accountId!==runtime.username);
check('old and new business references remain owned',[runtime.username,runtime.accountId].every(value=>box.ownsBusinessRef({username:runtime.username},value))&&!box.ownsBusinessRef({username:runtime.username},'another-account'));
check('signed verified session accepted',!!box.getSession(req));
check('secure HttpOnly cookie',box.sessionCookie(token).includes('; Secure')&&box.sessionCookie(token).includes('HttpOnly'));
let session=box.getSession(req);
result=await box.authApi({...req,method:'POST',headers:{...req.headers,'x-csrf-token':session.csrf}},null,new URL('http://localhost/api/auth/logout'));
check('logout revokes replayed cookie',result.status===200&&!box.getSession(req));
const freshToken=box.makeSession(runtime);const freshReq={...req,headers:{cookie:`nju_redcross_session=${freshToken}`}};
box.accountsByUsername.set(runtime.username,{...runtime,passwordHash:hashPassword('Another-Offline-Password')});
check('credential change invalidates old session',!box.getSession(freshReq));
const pending=await findAccountByLogin(client,email3);
result=await box.authApi({method:'POST',headers:{},socket:{remoteAddress:'offline'},body:{username:pending.username,password}},null,new URL('http://localhost/api/auth/login'));
check('pending account blocked at actual password-login endpoint',result.status===403&&result.body.code==='email_verification_required');
for(const alias of [profiles.get(email).studentId,'测试同学甲',email]) {
  const login=await box.authApi({method:'POST',headers:{},socket:{remoteAddress:'alias-test'},body:{username:alias,password:replacement}},null,new URL('http://localhost/api/auth/login'));
  check(`actual login endpoint accepts ${alias===email?'email':alias==='测试同学甲'?'real name':'student ID'}`,login.status===200&&login.body.authenticated);
}
const ambiguous=await box.authApi({method:'POST',headers:{},socket:{remoteAddress:'alias-test'},body:{username:'离线测试同学',password}},null,new URL('http://localhost/api/auth/login'));
check('actual login rejects ambiguous real name',ambiguous.status===409&&ambiguous.body.code==='ambiguous_login');
box.getIdentityBase=async()=>{throw new Error('offline simulated outage');};
await assert.rejects(()=>box.authApi({method:'POST',headers:{},socket:{remoteAddress:'offline'},body:{username:runtime.username,password:replacement}},null,new URL('http://localhost/api/auth/login')));
check('table outage never authenticates stale cached password',true);
ctx.requireSession=()=>({username:email});ctx.requireCsrf=()=>true;
let profile=await call('/api/auth/account',{}, {method:'GET'});
check('own profile excludes hashes and codes',profile.status===200&&!JSON.stringify(profile.body).includes('scrypt$')&&!('passwordHash' in profile.body.account));
profile=await call('/api/auth/account',{role:'platform_admin'}, {method:'PATCH'});
check('profile cannot escalate roles',profile.body.code==='profile_fields_forbidden');
profile=await call('/api/auth/account',{phone:'123'}, {method:'PATCH'});
check('profile rejects invalid phone',profile.body.code==='invalid_profile');
profile=await call('/api/auth/account',{realName:'替换姓名'}, {method:'PATCH'});
check('verified name cannot be silently replaced',profile.body.code==='identity_fields_locked');
profile=await call('/api/auth/account',{phone:'13800000000',department:'测试院系',grade:'2023'}, {method:'PATCH'});
check('own contact profile updates only private account',profile.status===200&&profile.body.account.phone==='13800000000'&&profile.body.account.role==='member');
ctx.requireCsrf=(_q,r)=>{ctx.json(r,403,{code:'csrf_failed'});return false;};
check('profile update requires CSRF',(await call('/api/auth/account',{phone:''},{method:'PATCH'})).status===403);
// Logged-in change-password uses the actual signed-session implementation.
ctx.accounts = box.accountsByUsername;
ctx.requireSession = (req,res) => {
  const session = box.getSession(req);
  if (!session) ctx.json(res,401,{ok:false,code:'unauthenticated'});
  return session;
};
ctx.requireCsrf = (req,res,session) => {
  if (req.headers['x-csrf-token'] === session.csrf) return true;
  ctx.json(res,403,{ok:false,code:'csrf_failed'});return false;
};
box.getIdentityBase = async()=>client;
async function changeHeaders() {
  const account=await findAccountByLogin(client,email);ctx.accounts.set(email,account);
  const token=box.makeSession(account);const req={headers:{cookie:`nju_redcross_session=${token}`}};
  return {cookie:req.headers.cookie,'x-csrf-token':box.getSession(req).csrf};
}
function freeChangeCooldown(){for(const r of tables.get(CODE_TABLE))if(r['邮箱']===email)r['创建时间']=new Date(Date.now()-3601000).toISOString();}
function changeOtp(){return mail.filter(m=>m.kind==='verification'&&m.to===email&&m.subject.includes('修改密码')).at(-1)?.text.match(/验证码是：(\d{6})/)[1];}
const beforeChange=await findAccountByLogin(client,email);
const headers=await changeHeaders();const otherDevice=await changeHeaders();
const ownPurpose=`change:${beforeChange.accountId}`;
check('change-code requires a signed session',(await call('/api/auth/change-password/code')).status===401);
check('change-submit requires a signed session',(await call('/api/auth/change-password',{code:'123456',password})).status===401);
check('change-code requires CSRF',(await call('/api/auth/change-password/code',{}, {headers:{cookie:headers.cookie}})).status===403);
check('change-submit requires CSRF',(await call('/api/auth/change-password',{code:'123456',password},{headers:{cookie:headers.cookie}})).status===403);
check('cross-origin password change denied',(await call('/api/auth/change-password/code',{}, {headers:{...headers,origin:'https://attacker.test'}})).status===403);
const mailCount=mail.length;
check('caller cannot choose another mailbox',(await call('/api/auth/change-password/code',{email:email2},{headers})).body.code==='change_fields_forbidden'&&mail.length===mailCount);
check('caller cannot choose another account or role',(await call('/api/auth/change-password',{code:'123456',password,username:email2,role:'platform_admin'},{headers})).body.code==='change_fields_forbidden');
ctx.config.registrationAvailable=false;
check('SMTP unavailable blocks authenticated change-code',(await call('/api/auth/change-password/code',{}, {headers})).status===503);
ctx.config.registrationAvailable=true;
const userRow=tables.get(ACCOUNT_TABLE).find(r=>r['邮箱']===email);
userRow['邮箱已验证']='未验证';
check('fresh store must confirm verified mailbox',(await call('/api/auth/change-password/code',{}, {headers})).body.code==='verified_email_required');
userRow['邮箱已验证']='已验证';
freeChangeCooldown();
result=await call('/api/auth/change-password/code',{}, {headers});
check('change code sent only to own mailbox without response secret',result.status===200&&mail.at(-1).to===email&&!('code' in result.body)&&!('devCode' in result.body));
check('change challenge binds purpose to stable account ID',latest(email,ownPurpose)?.['状态']==='待使用');
check('change request enforces persisted cooldown',(await call('/api/auth/change-password/code',{}, {headers})).status===429);
let ownCode=changeOtp();
if(resetCode!==ownCode)check('reset-purpose OTP cannot authorize authenticated change',(await call('/api/auth/change-password',{code:resetCode,password:'Changed1!'},{headers})).status===401);
check('new password complexity checked without consuming challenge',(await call('/api/auth/change-password',{code:ownCode,password:'short'},{headers})).body.code==='password_policy'&&latest(email,ownPurpose)['状态']==='待使用');
check('same password rejected without consuming challenge',(await call('/api/auth/change-password',{code:ownCode,password:replacement},{headers})).body.code==='password_unchanged'&&latest(email,ownPurpose)['状态']==='待使用');
latest(email,ownPurpose)['过期时间']=new Date(Date.now()-1).toISOString();
check('expired change challenge rejected',(await call('/api/auth/change-password',{code:ownCode,password:'Changed1!'},{headers})).body.code==='code_expired');
freeChangeCooldown();await call('/api/auth/change-password/code',{}, {headers});ownCode=changeOtp();
const badChangeCode=ownCode==='000000'?'111111':'000000';
for(let i=0;i<5;i++)await call('/api/auth/change-password',{code:badChangeCode,password:'Changed1!'},{headers});
check('five failures lock authenticated change challenge',latest(email,ownPurpose)['状态']==='已失效');
freeChangeCooldown();failMail=true;
result=await call('/api/auth/change-password/code',{}, {headers});
check('SMTP failure invalidates change challenge',result.status===502&&latest(email,ownPurpose)['状态']==='已失效');
failMail=false;freeChangeCooldown();await call('/api/auth/change-password/code',{}, {headers});ownCode=changeOtp();
const concurrentChanges=await Promise.all([
  call('/api/auth/change-password',{code:ownCode,password:'Changed1!'},{headers}),
  call('/api/auth/change-password',{code:ownCode,password:'Changed1!'},{headers}),
]);
check('concurrent authenticated changes consume code once',concurrentChanges.filter(r=>r.status===200).length===1&&concurrentChanges.filter(r=>r.status===401).length===1);
const changed=await findAccountByLogin(client,email);const changeSuccess=concurrentChanges.find(r=>r.status===200);
check('change stores salted hash and rejects old password',verifyPassword('Changed1!',changed.passwordHash)&&!verifyPassword(replacement,changed.passwordHash));
check('change preserves account ID role and profile',changed.accountId===beforeChange.accountId&&changed.role===beforeChange.role&&changed.realName===beforeChange.realName&&changed.studentId===beforeChange.studentId);
check('password change invalidates all existing device sessions',[headers,otherDevice].every(h=>!box.getSession({headers:h})));
check('change clears cookie and never automatically signs in',changeSuccess.headers['Set-Cookie']==='cookie='&&!changeSuccess.body.authenticated);
check('successful change sends security notification',changeSuccess.body.securityNoticeSent&&mail.at(-1).kind==='security'&&mail.at(-1).subject.includes('密码已修改'));
const newHeaders=await changeHeaders();
check('consumed change code rejected even in new session',(await call('/api/auth/change-password',{code:ownCode,password:'Changed2!'},{headers:newHeaders})).body.code==='code_unavailable');
check('old password rejected at real login endpoint',(await box.authApi({method:'POST',headers:{},socket:{remoteAddress:'change-old'},body:{username:email,password:replacement}},null,new URL('http://localhost/api/auth/login'))).status===401);
check('new password accepted at real login endpoint',(await box.authApi({method:'POST',headers:{},socket:{remoteAddress:'change-new'},body:{username:email,password:'Changed1!'}},null,new URL('http://localhost/api/auth/login'))).status===200);
// An unavailable post-change notice must not disguise a completed password change.
freeChangeCooldown();await call('/api/auth/change-password/code',{}, {headers:newHeaders});ownCode=changeOtp();failMail=true;
result=await call('/api/auth/change-password',{code:ownCode,password:'Changed2!'},{headers:newHeaders});failMail=false;
check('notice delivery failure does not undo completed change',result.status===200&&result.body.securityNoticeSent===false&&verifyPassword('Changed2!',(await findAccountByLogin(client,email)).passwordHash));
// Administrators use the same flow only after a verified campus mailbox is bound.
const adminRow={_id:'offline-admin-change',账号ID:'ACC-OFFLINE-ADMIN',登录名:'offline-admin',邮箱:'239000001@nju.edu.cn',密码哈希:hashPassword('Admin123!'),角色:'platform_admin',状态:'启用',邮箱已验证:'未验证'};
tables.get(ACCOUNT_TABLE).push(adminRow);let adminAccount=accountFromRow(adminRow);ctx.accounts.set(adminAccount.username,adminAccount);
const adminToken=box.makeSession(adminAccount);const adminReq={headers:{cookie:`nju_redcross_session=${adminToken}`}};
const adminHeaders={...adminReq.headers,'x-csrf-token':box.getSession(adminReq).csrf};
check('administrator with unverified mailbox cannot self-change',(await call('/api/auth/change-password/code',{}, {headers:adminHeaders})).body.code==='verified_email_required');
adminRow['邮箱已验证']='已验证';
result=await call('/api/auth/change-password/code',{}, {headers:adminHeaders});
check('verified administrator may receive own change challenge',result.status===200&&mail.at(-1).to===adminRow['邮箱']);
const adminOtp=mail.at(-1).text.match(/验证码是：(\d{6})/)[1];
result=await call('/api/auth/change-password',{code:adminOtp,password:'Admin456!'}, {headers:adminHeaders});
adminAccount=await findAccountByLogin(client,'offline-admin');
check('administrator change preserves privileges and invalidates prior session',result.status===200&&adminAccount.role==='platform_admin'&&verifyPassword('Admin456!',adminAccount.passwordHash)&&!box.getSession(adminReq));
// A legacy administrator can complete a missing real name without changing privileges.
const newAdminToken=box.makeSession(adminAccount);const nameReq={headers:{cookie:`nju_redcross_session=${newAdminToken}`}};
const nameHeaders={...nameReq.headers,'x-csrf-token':box.getSession(nameReq).csrf};
check('administrator rejects invalid real name',(await call('/api/auth/account',{realName:'123'}, {method:'PATCH',headers:nameHeaders})).body.code==='invalid_profile');
check('administrator cannot bind student ID through profile',(await call('/api/auth/account',{studentId:'239000001'}, {method:'PATCH',headers:nameHeaders})).body.code==='identity_fields_locked');
const adminHash=adminAccount.passwordHash;
const filledAdmin=await call('/api/auth/account',{realName:'测试管理员'}, {method:'PATCH',headers:nameHeaders});
const savedAdmin=await findAccountByLogin(client,'offline-admin');
check('administrator may complete a missing real name',filledAdmin.status===200&&filledAdmin.body.account.realName==='测试管理员'&&savedAdmin.realName==='测试管理员'&&savedAdmin.label==='测试管理员');
check('name completion preserves password email account ID and privileges',savedAdmin.passwordHash===adminHash&&savedAdmin.email===adminAccount.email&&savedAdmin.accountId===adminAccount.accountId&&savedAdmin.role==='platform_admin');
check('bound administrator name cannot be replaced',(await call('/api/auth/account',{realName:'另一位同学'}, {method:'PATCH',headers:nameHeaders})).body.code==='identity_fields_locked');
check('bound administrator name cannot be cleared',(await call('/api/auth/account',{realName:''}, {method:'PATCH',headers:nameHeaders})).body.code==='identity_fields_locked');
check('administrator contact-only update preserves bound name',(await call('/api/auth/account',{phone:'13800000001'}, {method:'PATCH',headers:nameHeaders})).body.account.realName==='测试管理员');
check('name completion never targets another account',(await call('/api/auth/account',{realName:'另一位同学',username:email}, {method:'PATCH',headers:nameHeaders})).body.code==='profile_fields_forbidden');
console.log(`Identity security regression: ${checks}/${checks} passed; external writes and emails: 0.`);
