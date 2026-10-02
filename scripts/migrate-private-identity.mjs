/** Explicit private Base migration. Preview first; preserves IDs, hashes and roles. */
import { Base } from 'seatable-api';
import { mkdir,writeFile } from 'node:fs/promises';
import { ACCOUNT_TABLE,ACCOUNT_COLUMNS,CODE_TABLE,CODE_COLUMNS,listIdentityRows } from '../lib/identity/store.js';
import { MAIL_TABLE,MAIL_COLUMNS } from '../lib/mailer.js';
import { BINDING_TABLE,BINDING_COLUMNS } from '../lib/identity/api.js';
const apply=process.argv.includes('--apply');
const server=process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn';
const source=new Base({server,APIToken:process.env.SEATABLE_API_TOKEN});
const target=new Base({server,APIToken:process.env.SEATABLE_IDENTITY_API_TOKEN});
const definitions=[{name:ACCOUNT_TABLE,columns:ACCOUNT_COLUMNS,key:'账号ID'},{name:CODE_TABLE,columns:CODE_COLUMNS,key:'验证码ID'},{name:MAIL_TABLE,columns:MAIL_COLUMNS,key:'记录ID'},{name:BINDING_TABLE,columns:BINDING_COLUMNS,key:'账号ID'}];
function values(row){return Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('_')).map(([k,v])=>[k,v??'']));}
try{
  await Promise.all([source.auth(),target.auth()]);
  if(target.dtableUuid!==process.env.SEATABLE_IDENTITY_BASE_UUID||source.dtableUuid===target.dtableUuid)throw new Error('Private Base UUID mismatch');
  const meta=await target.getMetadata();const current=new Map(meta.tables.map(t=>[t.name,t]));
  const sourceRows={};for(const d of definitions.slice(0,3))sourceRows[d.name]=await listIdentityRows(source,d.name);
  if(sourceRows[ACCOUNT_TABLE].some(r=>!r['账号ID']||!r['密码哈希']||!['member','platform_admin'].includes(r['角色'])))throw new Error('Invalid legacy account; preserve source and resolve before migration');
  if(new Set(sourceRows[ACCOUNT_TABLE].map(r=>r['账号ID'])).size!==sourceRows[ACCOUNT_TABLE].length)throw new Error('Duplicate source account IDs');
  console.log(JSON.stringify({mode:apply?'apply':'preview',privateBaseVerified:true,sourceCounts:Object.fromEntries(Object.entries(sourceRows).map(([k,v])=>[k,v.length])),tables:definitions.map(d=>({name:d.name,columns:d.columns,missing:!current.has(d.name)})),sourceWrites:0}));
  if(!apply)process.exit(0);
  const backup=process.env.IDENTITY_MIGRATION_BACKUP_DIR||'.private-identity-schema-backups';await mkdir(backup,{recursive:true,mode:0o700});
  await writeFile(`${backup}/identity-source-${Date.now()}.json`,JSON.stringify({businessBaseUuid:source.dtableUuid,identityBaseUuid:target.dtableUuid,rows:sourceRows}),{mode:0o600});
  for(const d of definitions){
    const table=current.get(d.name);
    if(!table){await target.addTable(d.name,'zh-cn',d.columns.map((n,i)=>({column_name:n,column_type:'text',anchor_column:i?d.columns[i-1]:''})));}
    else for(const name of d.columns){const col=table.columns.find(c=>c.name===name);if(col&&col.type!=='text')throw new Error('Incompatible private column');if(!col)await target.insertColumn(d.name,name,'text','');}
  }
  for(const d of definitions.slice(0,3)){
    const existing=await listIdentityRows(target,d.name);
    for(const row of sourceRows[d.name]){
      const payload=values(row);const found=existing.find(r=>r[d.key]===row[d.key]);
      if(found){if(Object.entries(payload).some(([k,v])=>JSON.stringify(v)!==JSON.stringify(found[k]??'')))throw new Error('Conflicting private row; refusing overwrite');}
      else await target.appendRow(d.name,payload);
    }
    const verified=await listIdentityRows(target,d.name);
    for(const row of sourceRows[d.name]){const matches=verified.filter(r=>r[d.key]===row[d.key]);if(matches.length!==1||Object.entries(values(row)).some(([k,v])=>JSON.stringify(v)!==JSON.stringify(matches[0][k]??'')))throw new Error('Migration verification mismatch');}
  }
  const links=await listIdentityRows(target,BINDING_TABLE);
  for(const a of sourceRows[ACCOUNT_TABLE])if(!links.some(r=>r['账号ID']===a['账号ID']))await target.appendRow(BINDING_TABLE,{账号ID:a['账号ID'],主业务BaseUUID:source.dtableUuid,业务标识:a['账号ID'],志愿者BaseUUID:process.env.SEATABLE_VOLUNTEER_BASE_UUID||'',学号:a['学号']||'',绑定状态:a['邮箱已验证']==='已验证'?'邮箱已验证；志愿者待核验':'邮箱待验证',更新时间:new Date().toISOString()});
  console.log(JSON.stringify({verified:true,accounts:sourceRows[ACCOUNT_TABLE].length,businessBaseUuid:source.dtableUuid,rolesPreserved:true,credentialHashesPreserved:true,sourceWrites:0}));
}catch(e){console.error(JSON.stringify({ok:false,status:e.response?.status||null,message:e.response?'Private identity migration request failed; credentials suppressed':e.message}));process.exitCode=1;}
