/** Private, verified account -> exact volunteer row. No browser-supplied row IDs. */
import { ACCOUNT_TABLE, listIdentityRows, accountFromRow } from './store.js';
export const PROFILE_TABLE = '个人主页（编辑版）';
export const PROFILE_BINDING_COLUMNS = ['资料BaseUUID','资料行ID','资料同步状态','资料导入完成','资料同步时间'];
export const PROFILE_FIELDS = {
  phone:'手机号', department:'院系', grade:'年级', gender:'性别', campus:'校区',
  contactEmail:'邮箱', wechat:'微信', qq:'QQ',
};
const privateColumns = {phone:'手机号',department:'院系',grade:'年级'};
const text = value => String(value ?? '').trim();
export function profileData(row) {
  try { const value=JSON.parse(row?.['志愿资料']||'{}');return value && typeof value==='object' && !Array.isArray(value)?value:{}; } catch { return {}; }
}
export function profilePatch(row, values) {
  const data=profileData(row);const patch={资料更新时间:new Date().toISOString()};
  for(const [key,value] of Object.entries(values)) {
    if(!Object.hasOwn(PROFILE_FIELDS,key))throw Error('Unapproved profile field');
    if(privateColumns[key])patch[privateColumns[key]]=value;else data[key]=value;
  }
  data.pending={...data.pending,...values};patch['志愿资料']=JSON.stringify(data);return patch;
}
export function validateProfileValues(values, options={}) {
  for(const [key,value] of Object.entries(values)) {
    if(!Object.hasOwn(PROFILE_FIELDS,key)||typeof value!=='string')return '个人资料字段格式不正确。';
    if(value.length>({phone:21,department:60,grade:20,gender:10,campus:20,contactEmail:160,wechat:60,qq:20}[key]))return '个人资料内容过长。';
    if(key==='phone' && value && !/^1\d{10}$/.test(value))return '请填写 11 位大陆手机号，或留空。';
    if(key==='qq' && value && !/^\d{5,20}$/.test(value))return '请核对 QQ 号码，或留空。';
    if(key==='contactEmail' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return '请填写有效的联系邮箱，或留空。';
    if(options[key] && value && !options[key].includes(value))return '请选择志愿服务平台已有的院系、年级、性别或校区选项。';
  }
  return '';
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
export function synchronizeProfile(client,ctx,account) {
  const task=tail.catch(()=>{}).then(()=>sync(client,ctx,account));tail=task;return task;
}
async function sync(client,ctx,account) {
  const result={account,state:'未连接',options:{},readonly:{}};
  if(!ctx.getProfileBase||!ctx.config.profileBaseUuid)return result;
  result.state='待核验';
  // Verified campus administrators may map by their mailbox prefix without changing their locked identity or role.
  const studentId=account.studentId || (account.role==='platform_admin'?account.email.split('@')[0]:'');
  if(!account.emailVerified || !/^[0-9]{6,20}$/.test(studentId||'') || !account.realName || !['smail.nju.edu.cn','nju.edu.cn'].includes(account.email.split('@')[1]) || account.email.split('@')[0]!==studentId)return result;
  let binding;
  async function conflict(){result.state='需人工核验';if(binding)await client.updateRow('账号关联表',binding._id,{资料同步状态:result.state});return result;}
  try {
    const source=await ctx.getProfileBase();if(source.dtableUuid!==ctx.config.profileBaseUuid)throw Error('Base mismatch');
    result.options=await getProfileOptions(ctx);
    const bindings=await listIdentityRows(client,'账号关联表');
    const owned=bindings.filter(r=>r['账号ID']===account.accountId);
    if(owned.length!==1){return await conflict();}
    binding=owned[0];
    if(binding['资料BaseUUID'] && binding['资料BaseUUID']!==ctx.config.profileBaseUuid){return await conflict();}
    // Numeric verified IDs make this fixed SQL query injection-safe and avoid reading every student's profile.
    const matches=await source.query(`SELECT * FROM \`个人主页（编辑版）\` WHERE \`学号\` = '${studentId}' LIMIT 3`);
    if(!Array.isArray(matches) || matches.some(r=>text(r['学号'])!==studentId))throw Error('Invalid profile query result');
    if(matches.length>1 || matches.some(r=>text(r['姓名'])!==account.realName)) {return await conflict();}
    let row=matches[0];
    if(binding['资料行ID'] && (!row || row._id!==binding['资料行ID'])){return await conflict();}
    if(row && bindings.some(b=>b['账号ID']!==account.accountId && b['资料BaseUUID']===ctx.config.profileBaseUuid && b['资料行ID']===row._id)){return await conflict();}
    if(!row) {
      // An uncertain append is reconciled by the exact student ID on the next attempt.
      const created=await source.appendRow(PROFILE_TABLE,{学号:studentId,姓名:account.realName});
      if(!created?._id)throw Error('Missing created profile row ID');
      row={_id:created._id,学号:studentId,姓名:account.realName};
    }
    await client.updateRow('账号关联表',binding._id,{资料BaseUUID:ctx.config.profileBaseUuid,资料行ID:row._id,资料同步状态:'同步中'});
    let accountRow=(await listIdentityRows(client,ACCOUNT_TABLE)).find(r=>r._id===account.rowId);
    if(!accountRow)throw Error('Account disappeared');
    let data=profileData(accountRow);
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
    const pending=data.pending||{};
    if(Object.keys(pending).length) {
      if(validateProfileValues(pending,result.options))throw Error('Pending profile requires corrected selection');
      const changes=Object.fromEntries(Object.entries(pending).map(([key,value])=>[PROFILE_FIELDS[key],key==='phone'?(value?Number(value):null):value]));
      await source.updateRow(PROFILE_TABLE,row._id,changes);
      row={...row,...changes};delete data.pending;
      const patch={'志愿资料':JSON.stringify(data)};await client.updateRow(ACCOUNT_TABLE,account.rowId,patch);accountRow={...accountRow,...patch};
    }
    result.account=accountFromRow(accountRow);
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
