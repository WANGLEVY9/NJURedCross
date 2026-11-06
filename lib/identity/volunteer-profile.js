/** Private, verified account -> exact volunteer row. No browser-supplied row IDs. */
import { ACCOUNT_TABLE, listIdentityRows, accountFromRow } from './store.js';
import { readIdentityRowsByField } from './account-query.js';
import {canonicalCertificate} from '../../public/app/shared/certificates.js';
import {mergeProfileFields} from './profile-merge.js';
import { readProfileCandidates } from './profile-query.js';
export const PROFILE_TABLE = '个人主页（编辑版）';
export const PROFILE_BINDING_COLUMNS = ['资料BaseUUID','资料行ID','资料同步状态','资料导入完成','资料同步时间'];
export const PROFILE_FIELDS = {
  phone:'手机号', department:'院系', grade:'年级', gender:'性别', campus:'校区',
  wechat:'微信', qq:'QQ', certificate:'急救证',
};
// 「联系邮箱」（旧志愿平台个人主页的「邮箱」列）已下线：新平台没有任何业务读取它，
// 与「收信邮箱」并列只会误导会员。历史值仍留在账号资料 JSON 与志愿平台列里，不删除数据，
// 但不再导入、不再同步、不再展示；历史 pending / 冲突 / 基线中的残留键统一忽略。
export const DEPRECATED_PROFILE_KEYS = ['contactEmail'];
const privateColumns = {phone:'手机号',department:'院系',grade:'年级'};
const text = value => String(value ?? '').trim();
/** Booking checks the same verified source column that the member profile edits. */
export async function accountWithProfileQualification(account,source){
 if(!account)return account;
 const studentId=account.studentId||(['platform_admin','super_admin'].includes(account.role)?String(account.email||'').split('@')[0]:'');
 const result={...account,certificate:'',qualificationState:'identity_unverified'};
 if(!account.emailVerified||!/^\d{6,20}$/.test(studentId)||!account.realName)return result;
 const rows=await readProfileCandidates(source,studentId);
 if(rows.length!==1)return {...result,qualificationState:rows.length?'duplicate_profile':'profile_missing'};
 if(text(rows[0]['姓名'])!==account.realName)return {...result,qualificationState:'identity_conflict'};
 const certificate=text(rows[0]['急救证']);
 return {...result,certificate,qualificationState:canonicalCertificate(certificate)?'complete':certificate?'unrecognized_certificate':'certificate_missing'};
}
export function profileData(row) {
  try { const value=JSON.parse(row?.['志愿资料']||'{}');return value && typeof value==='object' && !Array.isArray(value)?value:{}; } catch { return {}; }
}
export function profilePatch(row, values) {
  const data=profileData(row);const patch={资料更新时间:new Date().toISOString()};
  for(const [key,value] of Object.entries(values)) {
    if(!Object.hasOwn(PROFILE_FIELDS,key))throw Error('Unapproved profile field');
    if(privateColumns[key])patch[privateColumns[key]]=value;else data[key]=value;
  }
  if(Object.hasOwn(values,'certificate'))data.certificateSyncVersion=1;
  data.pending={...data.pending,...values};patch['志愿资料']=JSON.stringify(data);return patch;
}
export function validateProfileValues(values, options={}) {
  for(const [key,value] of Object.entries(values)) {
    if(!Object.hasOwn(PROFILE_FIELDS,key)||typeof value!=='string')return '个人资料字段格式不正确。';
    if(value.length>({phone:21,department:60,grade:20,gender:10,campus:20,wechat:60,qq:20,certificate:100}[key]))return '个人资料内容过长。';
    if(key==='phone' && value && !/^1\d{10}$/.test(value))return '请填写 11 位大陆手机号，或留空。';
    if(key==='qq' && value && !/^\d{5,20}$/.test(value))return '请核对 QQ 号码，或留空。';
    if(key==='certificate' && value && !canonicalCertificate(value))return '请选择有效的急救证情况；没有证书请选择“否”。';
    if(options[key] && value && !options[key].includes(value) && !(key==='certificate' && options[key].some(option=>canonicalCertificate(option)===canonicalCertificate(value))))return `请核对${({department:'院系',grade:'年级',gender:'性别',campus:'校区',certificate:'急救证'})[key]||key}，选择志愿服务平台已有选项。`;
  }
  return '';
}
function sourceValue(key,value,options){
 if(key==='phone')return value?Number(value):null;
 if(key==='certificate'&&value){
  const choices=options.certificate||[];
  return choices.find(option=>option===value)||choices.find(option=>canonicalCertificate(option)===canonicalCertificate(value))||value;
 }
 return value;
}
export async function getProfileOptions(ctx) {
  if(!ctx.getProfileBase)return {};
  const client=await ctx.getProfileBase();const table=(await client.getMetadata()).tables.find(t=>t.name===PROFILE_TABLE);
  if(!table || !['学号','姓名',...Object.values(PROFILE_FIELDS)].every(n=>table.columns.some(c=>c.name===n)))throw Error('Volunteer profile schema mismatch');
  return Object.fromEntries(Object.entries(PROFILE_FIELDS).flatMap(([key,name])=>{
    const column=table.columns.find(c=>c.name===name);
    return column.type==='single-select'?[[key,(column.data?.options||[]).map(o=>o.name)]]:[];
  }));
}
let tail=Promise.resolve();
/** Serialize binding/create/retry in the single production process. */
export function withProfileMutation(task) {
  const next=tail.catch(()=>{}).then(task);tail=next;return next;
}
export function synchronizeProfile(client,ctx,account) {
  return withProfileMutation(()=>sync(client,ctx,account));
}
async function sync(client,ctx,account) {
  const result={account,state:'未连接',options:{},readonly:{}};
  if(!ctx.getProfileBase||!ctx.config.profileBaseUuid)return result;
  result.state='待核验';
  // Verified campus administrators may map by their mailbox prefix without changing their locked identity or role.
  const studentId=account.studentId || (['platform_admin','super_admin'].includes(account.role)?account.email.split('@')[0]:'');
  if(!account.emailVerified || !/^[0-9]{6,20}$/.test(studentId||'') || !account.realName || !['smail.nju.edu.cn','nju.edu.cn'].includes(account.email.split('@')[1]) || account.email.split('@')[0]!==studentId)return result;
  let binding;
  async function conflict(){result.state='需人工核验';if(binding)await client.updateRow('账号关联表',binding._id,{资料同步状态:result.state});return result;}
  try {
    const source=await ctx.getProfileBase();if(source.dtableUuid!==ctx.config.profileBaseUuid)throw Error('Base mismatch');
    result.options=await getProfileOptions(ctx);
    const ownedLookup=await readIdentityRowsByField(client,'账号关联表','账号ID',account.accountId);
    const bindings=ownedLookup===null?await listIdentityRows(client,'账号关联表'):ownedLookup;
    const owned=bindings.filter(r=>r['账号ID']===account.accountId);
    if(owned.length!==1){return await conflict();}
    binding=owned[0];
    if(binding['资料BaseUUID'] && binding['资料BaseUUID']!==ctx.config.profileBaseUuid){return await conflict();}
    // Numeric verified IDs make this fixed SQL query injection-safe and avoid reading every student's profile.
    const matches = await readProfileCandidates(source, studentId);
    if(matches.length>1 || matches.some(r=>text(r['姓名'])!==account.realName)) {return await conflict();}
    let row=matches[0];
    if(binding['资料行ID'] && (!row || row._id!==binding['资料行ID'])){return await conflict();}
    const rowBindings=row?(await readIdentityRowsByField(client,'账号关联表','资料行ID',row._id)):[];
    const owners=rowBindings===null?await listIdentityRows(client,'账号关联表'):rowBindings;
    if(row && owners.some(b=>b['账号ID']!==account.accountId && b['资料BaseUUID']===ctx.config.profileBaseUuid && b['资料行ID']===row._id)){return await conflict();}
    if(!row) {
      // An uncertain append is reconciled by the exact student ID on the next attempt.
      const created=await source.appendRow(PROFILE_TABLE,{学号:studentId,姓名:account.realName,部门:'志愿者'});
      if(!created?._id)throw Error('Missing created profile row ID');
      row={_id:created._id,学号:studentId,姓名:account.realName,部门:'志愿者'};
    }
    result.readonly={division:text(row['部门']),firstAid:text(row['急救证']),totalHours:text(row['总志愿时长'])};
    await client.updateRow('账号关联表',binding._id,{资料BaseUUID:ctx.config.profileBaseUuid,资料行ID:row._id,资料同步状态:'同步中'});
    const accountRows=await readIdentityRowsByField(client,ACCOUNT_TABLE,'账号ID',account.accountId);
    let accountRow=(accountRows===null?await listIdentityRows(client,ACCOUNT_TABLE):accountRows).find(r=>r._id===account.rowId);
    if(!accountRow)throw Error('Account disappeared');
    let data=profileData(accountRow);
    for(const key of DEPRECATED_PROFILE_KEYS){
      if(data.pending)delete data.pending[key];
      if(data.syncConflicts)delete data.syncConflicts[key];
      if(data.syncBaseline)delete data.syncBaseline[key];
    }
    // Migrate obsolete declarations once. New explicit edits use the existing
    // three-way merge and must survive outages without overwriting source edits.
    if(data.certificateSyncVersion!==1){
      data.certificate=text(row['急救证']);
      if(data.pending)delete data.pending.certificate;
      if(data.syncConflicts)delete data.syncConflicts.certificate;
      data.syncBaseline={...data.syncBaseline,certificate:text(row['急救证'])};
      data.certificateSyncVersion=1;
    }
    accountRow={...accountRow,'志愿资料':JSON.stringify(data)};
    if(binding['资料导入完成']!=='是') {
      const imported={};
      for(const [key,column] of Object.entries(PROFILE_FIELDS)) {
        const value=text(row[column]);const current=privateColumns[key]?text(accountRow[privateColumns[key]]):text(data[key]);
        if(!current && value && !Object.hasOwn(data.pending||{},key) && !validateProfileValues({[key]:value},result.options))imported[key]=value;
      }
      if(Object.keys(imported).length) {
        const patch=profilePatch(accountRow,imported);
        // Import does not write back to the source; only user edits do.
        const next=JSON.parse(patch['志愿资料']);next.pending=data.pending||{};patch['志愿资料']=JSON.stringify(next);
        await client.updateRow(ACCOUNT_TABLE,account.rowId,patch);accountRow={...accountRow,...patch};data=next;
      }
      await client.updateRow('账号关联表',binding._id,{资料导入完成:'是'});
    }
    const remote=Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key,column])=>[key,text(row[column])]).filter(([key,value])=>!validateProfileValues({[key]:value},result.options)));
    const local=Object.fromEntries(Object.keys(PROFILE_FIELDS).map(key=>[key,privateColumns[key]?text(accountRow[privateColumns[key]]):text(data[key])]));
    const merged=mergeProfileFields({local,remote,baseline:data.syncBaseline||{},pending:data.pending||{}});
    const imports=Object.fromEntries(Object.entries(merged.pull).filter(([key,value])=>!validateProfileValues({[key]:value},result.options)));
    if(Object.keys(imports).length){
      const imported=profilePatch(accountRow,imports),next=JSON.parse(imported['志愿资料']);next.pending=data.pending||{};imported['志愿资料']=JSON.stringify(next);
      await client.updateRow(ACCOUNT_TABLE,account.rowId,imported);accountRow={...accountRow,...imported};data=next;
    }
    if(Object.keys(merged.conflicts).length){
      result.conflictFields=Object.keys(merged.conflicts);
      data.syncConflicts=merged.conflicts;await client.updateRow(ACCOUNT_TABLE,account.rowId,{'志愿资料':JSON.stringify(data)});
      result.account=accountFromRow({...accountRow,'志愿资料':JSON.stringify(data)});return await conflict();
    }
    const pending=data.pending||{};
    if(Object.keys(pending).length) {
      if(validateProfileValues(pending,result.options))throw Error('Pending profile requires corrected selection');
      const changes=Object.fromEntries(Object.entries(pending).map(([key,value])=>[PROFILE_FIELDS[key],sourceValue(key,value,result.options)]));
      await source.updateRow(PROFILE_TABLE,row._id,changes);
      row={...row,...changes};
      result.readonly={division:text(row['部门']),firstAid:text(row['急救证']),totalHours:text(row['总志愿时长'])};
      if(Object.hasOwn(pending,'certificate'))data.certificate=text(row['急救证']);
      delete data.pending;
      const patch={'志愿资料':JSON.stringify(data)};await client.updateRow(ACCOUNT_TABLE,account.rowId,patch);accountRow={...accountRow,...patch};
    }
    data.syncBaseline={...data.syncBaseline,...Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key,column])=>[key,text(row[column])]).filter(([key,value])=>!validateProfileValues({[key]:value},result.options)))};delete data.syncConflicts;
    await client.updateRow(ACCOUNT_TABLE,account.rowId,{'志愿资料':JSON.stringify(data)});accountRow={...accountRow,'志愿资料':JSON.stringify(data)};
    result.account=accountFromRow(accountRow);
    if(!text(row['部门'])){await source.updateRow(PROFILE_TABLE,row._id,{部门:'志愿者'});row={...row,部门:'志愿者'};}
    result.readonly={division:text(row['部门']),firstAid:text(row['急救证']),totalHours:text(row['总志愿时长'])};
    result.state='已同步';
    await client.updateRow('账号关联表',binding._id,{资料同步状态:result.state,资料同步时间:new Date().toISOString()});
  } catch {
    // Never expose SDK exceptions, tokens or other students' data. Pending edits remain durable.
    result.state='待重试';
    if(binding)try{await client.updateRow('账号关联表',binding._id,{资料同步状态:result.state});}catch{}
    try { const rows=await listIdentityRows(client,ACCOUNT_TABLE);result.account=accountFromRow(rows.find(r=>r._id===account.rowId))||account; } catch {}
  }
  return result;
}
