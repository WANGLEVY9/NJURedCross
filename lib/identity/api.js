import { hashPasswordAsync as hashPassword, verifyPasswordAsync as verifyPassword } from './password-async.js';
/** SMTP-backed identity flows. All email mutations serialize in this single Node process. */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { ACCOUNT_TABLE, CODE_TABLE, createAccountRow, findAccountByLogin, generateMemberCode, updateAccountFields, listIdentityRows, accountFromRow } from './store.js';

import { latestChallenge } from './challenges.js';

import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordPolicyError, registrationProfileError, realNameError } from '../../public/app/core/password-policy.js';

import { PROFILE_BINDING_COLUMNS, PROFILE_FIELDS, profilePatch, validateProfileValues, getProfileOptions, synchronizeProfile } from './volunteer-profile.js';

const TTL = 600;
const MAX_ATTEMPTS = 5;
const locks = new Map();
const ipHistory = new Map();

async function withLock(email, action) {
  const previous = locks.get(email) || Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  locks.set(email, task);
  try { return await task; } finally { if (locks.get(email) === task) locks.delete(email); }
}
export const BINDING_TABLE = '账号关联表';
export const BINDING_COLUMNS = ['账号ID','主业务BaseUUID','业务标识','志愿者BaseUUID','学号','绑定状态','更新时间',...PROFILE_BINDING_COLUMNS];
async function ensureBinding(client,ctx,account) {
  if (!ctx.config.privateIdentity) return;
  const rows=await listIdentityRows(client,BINDING_TABLE);
  const values={账号ID:account.accountId,主业务BaseUUID:ctx.config.businessBaseUuid||'',业务标识:account.accountId,志愿者BaseUUID:ctx.config.volunteerBaseUuid||'',学号:account.studentId||'',绑定状态:account.emailVerified?'邮箱已验证；志愿者待核验':'邮箱待验证',更新时间:new Date().toISOString()};
  const found=rows.find(r=>r['账号ID']===account.accountId);
  if(found)await client.updateRow(BINDING_TABLE,found._id,values);else await client.appendRow(BINDING_TABLE,values);
}
function emailValue(value) { return String(value || '').trim().toLowerCase(); }
function allowedEmail(email, domains) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(email)
    && domains.includes(email.split('@')[1]) && email.length <= 160;
}
function sameOrigin(req) {
  if (!req.headers.origin) return true; // Non-browser clients still face limits and code/password checks.
  try { const origin = new URL(req.headers.origin); return origin.host === req.headers.host && ['https:', 'http:'].includes(origin.protocol); }
  catch { return false; }
}
function ipLimit(req, ctx, action) {
  const key = `${action}:${ctx.clientIp(req)}`;
  const now = Date.now();
  const windowMs = action === 'send' ? 3600000 : 600000;
  const max = action === 'send' ? 20 : 40;
  const stamps = (ipHistory.get(key) || []).filter(t => t > now - windowMs);
  if (stamps.length >= max) return false;
  stamps.push(now); ipHistory.set(key, stamps);
  if (ipHistory.size > 2000) for (const [k, times] of ipHistory) if (times.at(-1) < now - 3600000) ipHistory.delete(k);
  return true;
}
function digest(ctx, email, purpose, id, code) {
  return createHmac('sha256', ctx.config.codeSecret).update(`${email}:${purpose}:${id}:${code}`).digest('hex');
}
function equals(left, right) {
  const a = Buffer.from(String(left)), b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
function failure(ctx, res, status, code, message, extra = {}) { return ctx.json(res, status, { ok: false, code, message, ...extra }); }
function available(ctx, res) {
  if (ctx.config.registrationAvailable && ctx.config.codeSecret) return true;
  failure(ctx, res, 503, 'registration_unavailable', '验证码邮件服务暂不可用，请稍后再试。'); return false;
}
function passwordValid(ctx, res, password) {
  if (passwordPolicyError(password)) {
    failure(ctx, res, 400, 'password_policy', PASSWORD_HINT); return false;
  }
  return true;
}
function disabled(account) { return account?.status && account.status !== '启用'; }
async function codesFor(client, email) { return (await listIdentityRows(client, CODE_TABLE)).filter(r => emailValue(r['邮箱']) === email); }
function cooldown(rows) {
  const now = Date.now();
  const times = rows.map(r => Date.parse(r['创建时间'])).filter(t => Number.isFinite(t) && t > now - 3600000).sort((a,b) => b-a);
  if (times.length && now - times[0] < 60000) return Math.ceil((60000 - now + times[0])/1000);
  if (times.length >= 5) return Math.max(1, Math.ceil((times.at(-1) + 3600000 - now)/1000));
  return 0;
}
async function issue(client, ctx, {email, purpose, ip}) {
  const rows = await codesFor(client, email);
  const retryAfter = cooldown(rows);
  if (retryAfter) return { rateLimited: true, retryAfter };
  // New issuance invalidates every previous challenge for this purpose.
  for (const row of rows) if (row['用途'] === purpose && row['状态'] === '待使用') await client.updateRow(CODE_TABLE, row._id, {状态:'已失效'});
  const id = ctx.identifier('VCD');
  const code = String(randomInt(0,1000000)).padStart(6,'0');
  const created = await client.appendRow(CODE_TABLE, {
    验证码ID:id, 邮箱:email, 用途:purpose, 验证码哈希:digest(ctx,email,purpose,id,code), 状态:'待使用',
    过期时间:new Date(Date.now()+TTL*1000).toISOString(), 尝试次数:'0', 创建时间:new Date().toISOString(), 消费时间:'', IP:String(ip||''),
  });
  const intent = purpose === 'reset' ? '重置密码' : purpose.startsWith('change:') ? '修改密码' : '注册';
  const delivery = await ctx.sendMail({
    to:email, subject:`南京大学红十字会网站｜${intent}验证码`,
    text:`你好！\n\n你的${intent}验证码是：${code}\n\n10 分钟内有效，仅本次用途可用。重新发送后旧验证码失效。请勿向他人提供验证码。若非本人操作，请忽略本邮件。\n\n南京大学红十字会网站`,
    kind:'verification', idempotencyKey:`VCD:${id}`,
  });
  if (!delivery.ok || delivery.devCodeChannel) {
    // A console/log transport never qualifies as mailbox ownership proof.
    const target = created?._id ? created : (await codesFor(client,email)).find(r=>r['验证码ID']===id);
    if (target?._id) await client.updateRow(CODE_TABLE,target._id,{状态:'已失效'});
    return {failed:true};
  }
  return {id, expiresInSeconds:TTL, retryAfter:60};
}
async function checkCode(client, ctx, res, email, purpose, code) {
  if (!/^\d{6}$/.test(String(code||''))) { failure(ctx,res,400,'invalid_code','请输入 6 位数字验证码。'); return null; }
  const selection = latestChallenge(await codesFor(client,email),purpose);
  if(selection.ambiguous){failure(ctx,res,409,'code_ambiguous','验证码记录有冲突，请重新获取。');return null;}
  const row = selection.row;
  if (!row || row['状态'] !== '待使用') { failure(ctx,res,400,'code_unavailable','验证码已使用或失效，请重新获取。'); return null; }
  const expiry=Date.parse(row['过期时间']);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) { await client.updateRow(CODE_TABLE,row._id,{状态:'已过期'}); failure(ctx,res,400,'code_expired','验证码已过期，请重新获取。'); return null; }
  const attempts=Number(row['尝试次数']||0);
  if (!Number.isInteger(attempts) || attempts<0 || attempts>=MAX_ATTEMPTS) { failure(ctx,res,429,'code_locked','尝试次数过多，请重新获取验证码。'); return null; }
  if (!equals(digest(ctx,email,purpose,row['验证码ID'],code),row['验证码哈希'])) {
    await client.updateRow(CODE_TABLE,row._id,{尝试次数:String(attempts+1), ...(attempts+1>=MAX_ATTEMPTS?{状态:'已失效'}:{})});
    failure(ctx,res,attempts+1>=MAX_ATTEMPTS?429:401,'invalid_code',attempts+1>=MAX_ATTEMPTS?'错误次数达到 5 次，请重新获取验证码。':'验证码错误，请使用最新邮件中的验证码。'); return null;
  }
  return row;
}
function rateLimited(ctx,res,retryAfter) { return ctx.json(res,429,{ok:false,code:'send_rate_limited',message:`发送太频繁，请 ${retryAfter} 秒后再试。`,retryAfter},{'Retry-After':String(retryAfter)}); }

export async function identityRoutes(req,res,url,ctx) {
  const path=url.pathname;
  if(req.method==='GET' && path==='/api/auth/registration-config') return ctx.json(res,200,{
    ok:true, enabled:Boolean(ctx.config.registrationAvailable), minimumPasswordLength:MIN_PASSWORD_LENGTH, passwordHint:PASSWORD_HINT,
    maximumPasswordLength:72, emailDomains:ctx.config.smailDomains, expiresInSeconds:TTL, resendAfterSeconds:60,
    message:ctx.config.registrationAvailable?'校园邮箱注册已开放。':'验证码邮件服务暂不可用。',
  });
  if(['GET','PATCH'].includes(req.method) && path==='/api/auth/account') return profile(req,res,ctx);
  if(req.method==='POST' && ['/api/auth/change-password/code','/api/auth/change-password'].includes(path)) return changePassword(req,res,ctx,path);
  if(req.method!=='POST' || !['/api/auth/register','/api/auth/email-codes','/api/auth/verify-email','/api/auth/reset-password'].includes(path)) return false;
  if(!sameOrigin(req)) return failure(ctx,res,403,'origin_forbidden','请求来源不受信任。');
  if(!available(ctx,res)) return;
  const body=await ctx.readJson(req);
  const email=emailValue(path==='/api/auth/register' && !body.email ? `${body.studentId||''}@${body.emailDomain||''}` : body.email);
  if(!allowedEmail(email,ctx.config.smailDomains)) return failure(ctx,res,400,'invalid_email','请填写 @smail.nju.edu.cn 或 @nju.edu.cn 校园邮箱。');
  const action=['/api/auth/register','/api/auth/email-codes'].includes(path)?'send':'verify';
  if(!ipLimit(req,ctx,action)) return rateLimited(ctx,res,600);
  if(path==='/api/auth/email-codes' && body.purpose==='reset') {
    // Identical immediate response; account lookup and SMTP run outside the response path.
    void withLock(email, async()=>{
      const client=await ctx.getBase();const account=await findAccountByLogin(client,email);
      if(!account || disabled(account) || account.role!=='member' || !account.emailVerified || account.email!==email) return;
      const result=await issue(client,ctx,{email,purpose:'reset',ip:ctx.clientIp(req)});
      await ctx.recordAudit(req,{username:email,role:'member'},'identity.reset.request',email,result.failed?'failed':result.rateLimited?'limited':'success',{});
    }).catch(()=>console.error('Password reset delivery job failed; retry is available.'));
    return ctx.json(res,202,{ok:true,retryAfter:60,expiresInSeconds:TTL,message:'如果该邮箱对应已验证的学生账号，重置验证码将发送到邮箱。请查收并在 60 秒后再重试。'});
  }
  return withLock(email,async()=>{
    const client=await ctx.getBase();
    const account=await findAccountByLogin(client,email);
    if(path==='/api/auth/register') return withLock('registration-profile',()=>register(req,res,ctx,client,body,email,account));
    if(path==='/api/auth/email-codes') {
      if(!account) return failure(ctx,res,404,'account_missing','尚未注册，请先创建账号。');
      if(disabled(account)) return failure(ctx,res,403,'account_disabled','账号已停用，请联系管理员。');
      if(account.emailVerified) return failure(ctx,res,409,'email_already_verified','邮箱已验证，请直接登录。');
      const result=await issue(client,ctx,{email,purpose:'register',ip:ctx.clientIp(req)});
      if(result.rateLimited) return rateLimited(ctx,res,result.retryAfter);
      if(result.failed) return failure(ctx,res,502,'verification_delivery_failed','验证码发送失败，请稍后重试。');
      return ctx.json(res,200,{ok:true,...result,message:'最新验证码已发送，旧验证码已失效。'});
    }
    if(!account || disabled(account) || account.role!=='member') return failure(ctx,res,400,'account_unavailable','账号不可用，请联系管理员。');
    if(path==='/api/auth/verify-email') {
      if(account.emailVerified) return failure(ctx,res,409,'email_already_verified','邮箱已验证，请直接登录。');
      const row=await checkCode(client,ctx,res,email,'register',body.code); if(!row) return;
      // Prevent pre-registration attacks: verification must also prove knowledge
      // of the password chosen for this exact pending account.
      if(!await verifyPassword(body.password,account.passwordHash)) {
        const attempts=Number(row['尝试次数']||0)+1;
        await client.updateRow(CODE_TABLE,row._id,{尝试次数:String(attempts),...(attempts>=MAX_ATTEMPTS?{状态:'已失效'}:{})});
        return failure(ctx,res,401,'registration_password_mismatch','请输入本次注册时设置的密码；也可返回注册页重新设置。');
      }
      await client.updateRow(CODE_TABLE,row._id,{状态:'已消费',消费时间:new Date().toISOString()});
      const memberCode=account.memberCode||generateMemberCode();
      await updateAccountFields(client,account.rowId,{邮箱已验证:'已验证',身份码:memberCode,最近登录:new Date().toISOString()});
      const runtime={...account,memberCode,emailVerified:true};ctx.accounts.set(account.username,runtime);
      await ensureBinding(client,ctx,runtime);
      const mapped=await synchronizeProfile(client,ctx,runtime);ctx.accounts.set(runtime.username,mapped.account);
      await ctx.recordAudit(req,runtime,'identity.email.verify',account.username,'success',{});
      const token=ctx.makeSession(mapped.account);const session=ctx.getSession({headers:{cookie:`nju_redcross_session=${token}`}});
      return ctx.json(res,200,{...ctx.sessionPayload(session),memberCode,message:'邮箱验证成功，已完成登录。'},{'Set-Cookie':ctx.sessionCookie(token)});
    }
    if(!account.emailVerified || account.email!==email) return failure(ctx,res,400,'account_unavailable','请先完成注册邮箱验证。');
    if(!passwordValid(ctx,res,body.password)) return;
    const row=await checkCode(client,ctx,res,email,'reset',body.code);if(!row)return;
    const passwordHash=await hashPassword(body.password);
    await client.updateRow(CODE_TABLE,row._id,{状态:'已消费',消费时间:new Date().toISOString()});
    await updateAccountFields(client,account.rowId,{密码哈希:passwordHash,失败次数:'0',锁定至:''});
    ctx.accounts.set(account.username,{...account,passwordHash});
    await ctx.recordAudit(req,account,'identity.password.reset',account.username,'success',{});
    await ctx.sendMail({to:email,subject:'南京大学红十字会网站｜密码已重置',text:'你的账号密码已通过邮箱验证码重置，旧登录会话已失效。若非本人操作，请立即联系网站管理员。\n\n南京大学红十字会网站',kind:'security',idempotencyKey:`RESET:${row['验证码ID']}`});
    return ctx.json(res,200,{ok:true,message:'密码已重置，旧会话已失效，请使用新密码登录。'},{'Set-Cookie':ctx.sessionCookie('',0)});
  });
}
async function changePassword(req, res, ctx, path) {
  if (!sameOrigin(req)) return failure(ctx,res,403,'origin_forbidden','请求来源不受信任。');
  const session = ctx.requireSession(req,res); if (!session) return;
  if (!ctx.requireCsrf(req,res,session) || !available(ctx,res)) return;
  const sending = path.endsWith('/code');
  if (!ipLimit(req,ctx,sending ? 'send' : 'verify')) return rateLimited(ctx,res,600);
  const body = await ctx.readJson(req);
  const fields = sending ? [] : ['code','password'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
    return failure(ctx,res,400,'change_fields_forbidden','修改密码只能操作当前登录账号，不能指定其他邮箱或账号。');
  }
  const client = await ctx.getBase();
  const original = await findAccountByLogin(client,session.username);
  const email = emailValue(original?.email);
  if (!original || disabled(original) || !original.emailVerified || !allowedEmail(email,ctx.config.smailDomains)) {
    return failure(ctx,res,403,'verified_email_required','账号尚未绑定已验证的校园邮箱，请联系管理员处理。');
  }
  // Share the mailbox lock with forgotten-password resets. Reload the account
  // before checking the session so a concurrently changed credential fails closed.
  return withLock(email,async()=>{
    const account = await findAccountByLogin(client,session.username);
    if (!account) return failure(ctx,res,401,'account_unavailable','账号不可用，请重新登录。');
    ctx.accounts.set(account.username,account);
    if (!ctx.requireSession(req,res)) return;
    if (disabled(account) || !account.emailVerified || emailValue(account.email) !== email) {
      return failure(ctx,res,403,'verified_email_required','账号邮箱状态已变化，请重新登录后再试。');
    }
    const purpose = `change:${account.accountId || account.username}`;
    if (sending) {
      const result = await issue(client,ctx,{email,purpose,ip:ctx.clientIp(req)});
      if (result.rateLimited) return rateLimited(ctx,res,result.retryAfter);
      if (result.failed) return failure(ctx,res,502,'verification_delivery_failed','验证码发送失败，请稍后重试。');
      await ctx.recordAudit(req,account,'identity.password.change.request',account.accountId,'success',{});
      return ctx.json(res,200,{ok:true,expiresInSeconds:TTL,retryAfter:60,message:'修改密码验证码已发送到当前账号的已验证邮箱。'});
    }
    if (!passwordValid(ctx,res,body.password)) return;
    if (await verifyPassword(body.password,account.passwordHash)) return failure(ctx,res,400,'password_unchanged','新密码不能与当前密码相同。');
    const row = await checkCode(client,ctx,res,email,purpose,body.code); if (!row) return;
    const passwordHash = await hashPassword(body.password);
    await client.updateRow(CODE_TABLE,row._id,{状态:'已消费',消费时间:new Date().toISOString()});
    await updateAccountFields(client,account.rowId,{密码哈希:passwordHash,失败次数:'0',锁定至:''});
    ctx.accounts.set(account.username,{...account,passwordHash});
    await ctx.recordAudit(req,account,'identity.password.change',account.accountId,'success',{});
    let securityNoticeSent = false;
    try {
      const delivery = await ctx.sendMail({to:email,subject:'南京大学红十字会网站｜密码已修改',
        text:'你的账号密码已通过邮箱验证码修改，全部旧登录会话已失效，请使用新密码重新登录。若非本人操作，请立即联系网站管理员。\n\n南京大学红十字会网站',
        kind:'security',idempotencyKey:`CHANGE:${row['验证码ID']}`});
      securityNoticeSent = Boolean(delivery?.ok && !delivery.devCodeChannel);
    } catch { console.error('Password change security notice failed; credential change completed.'); }
    return ctx.json(res,200,{ok:true,securityNoticeSent,message:'密码已修改，全部旧会话已失效，请使用新密码登录。'},
      {'Set-Cookie':ctx.sessionCookie('',0)});
  });
}

async function register(req,res,ctx,client,body,email,account) {
  if(!passwordValid(ctx,res,body.password)) return;
  const realName = typeof body.realName === 'string' ? body.realName.trim() : '';
  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  const profileError = registrationProfileError(realName, studentId);
  if (profileError) return failure(ctx,res,400,'invalid_profile',profileError);
  if (email.split('@')[0] !== studentId) return failure(ctx,res,400,'student_email_mismatch','校园邮箱前缀必须与本人学号一致。');
  if(account?.emailVerified) return failure(ctx,res,409,'email_already_verified','该邮箱已注册，请登录或找回密码。');
  if(disabled(account)) return failure(ctx,res,403,'account_disabled','该账号已停用，请联系管理员。');
  const duplicate = (await listIdentityRows(client,ACCOUNT_TABLE)).some(row => row['学号'] === studentId && row._id !== account?.rowId);
  if (duplicate) return failure(ctx,res,409,'student_id_in_use','该学号已关联账号，请使用原校园邮箱登录或找回密码；如有误请联系管理员。');
  const retry=cooldown(await codesFor(client,email));if(retry)return rateLimited(ctx,res,retry);
  if(account) {
    if(account.role!=='member') return failure(ctx,res,409,'account_unavailable','该邮箱不可用于自助注册。');
    // A pending signup can be restarted without creating duplicate accounts.
    await updateAccountFields(client,account.rowId,{密码哈希:await hashPassword(body.password),真实姓名:realName,学号:studentId,显示名:realName});
  } else {
    await createAccountRow(client,{login:email,email,passwordHash:await hashPassword(body.password),role:'member',displayName:realName,realName,studentId});
  }
  await ensureBinding(client,ctx,await findAccountByLogin(client,email));
  const result=await issue(client,ctx,{email,purpose:'register',ip:ctx.clientIp(req)});
  if(result.rateLimited) return rateLimited(ctx,res,result.retryAfter);
  await ctx.recordAudit(req,{username:email,role:'member'},'identity.register',email,result.failed?'mail-failed':'success',{});
  return ctx.json(res,201,{ok:true,email,deliveryStatus:result.failed?'failed':'sent',expiresInSeconds:TTL,retryAfter:60,message:result.failed?'账号待验证，但邮件发送失败，请在验证页稍后重发。':'验证码已发送，请输入验证码及本次设置的密码完成注册。'});
}
async function profile(req,res,ctx) {
  const session=ctx.requireSession(req,res);if(!session)return;
  if(req.method==='PATCH' && !ctx.requireCsrf(req,res,session))return;
  return withLock(session.username,async()=>{
    const client=await ctx.getBase();let account=await findAccountByLogin(client,session.username);
    if(!account||disabled(account))return failure(ctx,res,404,'account_missing','账号不可用。');
    if(req.method==='PATCH'){
      const body=await ctx.readJson(req);
      const allowed=['realName','studentId',...Object.keys(PROFILE_FIELDS)];
      if(!body || typeof body!=='object' || Array.isArray(body))return failure(ctx,res,400,'invalid_profile','个人资料格式不正确。');
      if(Object.keys(body).some(k=>!allowed.includes(k)))return failure(ctx,res,400,'profile_fields_forbidden','此页面仅可更新个人资料，不能修改邮箱、密码或角色。');
      const realName=String(body.realName??account.realName).trim();
      const studentId=String(body.studentId??account.studentId).trim();
      // Missing names may be completed once for both members and administrators.
      if ((account.realName && realName !== account.realName) || (account.studentId && studentId !== account.studentId)) {
        return failure(ctx,res,400,'identity_fields_locked','姓名和学号已绑定，如需更正请联系管理员。');
      }
      if (realName && realNameError(realName)) return failure(ctx,res,400,'invalid_profile',realNameError(realName));
      if (account.role !== 'member' && studentId !== account.studentId) {
        return failure(ctx,res,400,'identity_fields_locked','管理员学号须由负责人核验绑定，不能在个人资料中修改。');
      }
      if(account.role==='member'){
        const err=registrationProfileError(realName,studentId);if(err)return failure(ctx,res,400,'invalid_profile',err);
        if(!account.studentId&&account.email.split('@')[0]!==studentId)return failure(ctx,res,400,'student_email_mismatch','学号须与已验证校园邮箱前缀一致。');
      }
      const edits=Object.fromEntries(Object.keys(PROFILE_FIELDS).filter(k=>Object.hasOwn(body,k)).map(k=>[k,typeof body[k]==='string'?body[k].trim():body[k]]));
      let options={};
      if(ctx.getProfileBase){try{options=await getProfileOptions(ctx);}catch{ /* Preserve private saves during a source outage; retry validates source choices. */ }}
      const invalid=validateProfileValues(edits,options);if(invalid)return failure(ctx,res,400,'invalid_profile',invalid);
      return withLock('registration-profile',async()=>{
        if(studentId&&(await listIdentityRows(client,ACCOUNT_TABLE)).some(r=>String(r['学号']||'').trim()===studentId&&r._id!==account.rowId))return failure(ctx,res,409,'student_id_in_use','该学号已关联其他账号，请联系管理员。');
        const currentRow=(await listIdentityRows(client,ACCOUNT_TABLE)).find(r=>r._id===account.rowId);
        const patch=profilePatch(currentRow,edits);
        if(realName && realName!==account.realName)Object.assign(patch,{真实姓名:realName,显示名:realName});
        if(account.role==='member')Object.assign(patch,{学号:studentId});
        await updateAccountFields(client,account.rowId,patch);
        account=accountFromRow({...((await listIdentityRows(client,ACCOUNT_TABLE)).find(r=>r._id===account.rowId))});
        ctx.accounts.set(account.username,account);await ensureBinding(client,ctx,account);
        await ctx.recordAudit(req,account,'identity.profile.update',account.accountId,'success',{fields:Object.keys(body)});
        const mapping=await synchronizeProfile(client,ctx,account);ctx.accounts.set(account.username,mapping.account);
        return ctx.json(res,200,{ok:true,account:publicProfile(mapping.account),profileMapping:publicMapping(mapping),message:mapping.state==='已同步'?'个人资料已保存并同步至志愿服务平台。':'个人资料已保存，志愿平台同步待处理。'});
      });
    }
    await ensureBinding(client,ctx,account);
    const mapping=await synchronizeProfile(client,ctx,account);ctx.accounts.set(account.username,mapping.account);
    return ctx.json(res,200,{ok:true,account:publicProfile(mapping.account),profileMapping:publicMapping(mapping)});
  });
}
function publicMapping(mapping){return {state:mapping.state,options:mapping.options,readonly:mapping.readonly};}
function publicProfile(account){
  return {gender:account.gender||'',campus:account.campus||'',contactEmail:account.contactEmail||'',wechat:account.wechat||'',qq:account.qq||'',accountId:account.accountId,username:account.username,email:account.email,displayName:account.label,realName:account.realName,studentId:account.studentId,phone:account.phone,department:account.department,grade:account.grade,role:account.role,memberCode:account.memberCode,emailVerified:account.emailVerified,registeredAt:account.registeredAt,lastLoginAt:account.lastLoginAt};
}
