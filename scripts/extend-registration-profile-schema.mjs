/** Add only real-name/student-ID text columns; preview by default, never rewrite accounts. */
import { Base } from 'seatable-api';
import { mkdir, writeFile } from 'node:fs/promises';
import { ACCOUNT_TABLE, listIdentityRows } from '../lib/identity/store.js';
if(process.env.SEATABLE_IDENTITY_API_TOKEN)throw new Error('Identity is configured separately; use migrate-private-identity.mjs, not the old business profile extension.');
const apply=process.argv.includes('--apply');
const base=new Base({server:(process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn').replace(/\/$/,''),APIToken:process.env.SEATABLE_API_TOKEN});
try {
  await base.auth();
  const metadata=await base.getMetadata();
  const table=metadata.tables.find(t=>t.name===ACCOUNT_TABLE);
  if(!table)throw new Error('Account table missing');
  const fields=['真实姓名','学号'];
  for(const field of fields)if(table.columns.some(c=>c.name===field&&c.type!=='text'))throw new Error('Profile column has incompatible type');
  const missing=fields.filter(f=>!table.columns.some(c=>c.name===f));
  const before=await listIdentityRows(base,ACCOUNT_TABLE);
  const identifiers=before.map(r=>String(r['学号']||'').trim()).filter(Boolean);
  if(new Set(identifiers).size!==identifiers.length)throw new Error('Duplicate existing student IDs require resolution');
  console.log(JSON.stringify({mode:apply?'apply':'preview',table:ACCOUNT_TABLE,addTextColumns:missing,existingAccounts:before.length,rowUpdates:0,crossBaseWrites:0}));
  if(apply&&missing.length){
    const backup=process.env.IDENTITY_SCHEMA_BACKUP_DIR||'.private-identity-schema-backups';
    await mkdir(backup,{recursive:true,mode:0o700});
    // Metadata contains no password or credential values.
    await writeFile(`${backup}/profile-${Date.now()}.json`,JSON.stringify(table,null,2),{mode:0o600});
    for(const field of missing)await base.insertColumn(ACCOUNT_TABLE,field,'text','');
    const verified=(await base.getMetadata()).tables.find(t=>t.name===ACCOUNT_TABLE);
    if(fields.some(f=>!verified.columns.some(c=>c.name===f&&c.type==='text')))throw new Error('Column verification failed');
    const after=await listIdentityRows(base,ACCOUNT_TABLE);
    if(JSON.stringify(before)!==JSON.stringify(after)){
      // New empty column keys can change serialization; compare only original values.
      if(before.length!==after.length||before.some((r,i)=>Object.entries(r).some(([k,v])=>JSON.stringify(v)!==JSON.stringify(after[i][k]))))throw new Error('Account rows changed during migration; inspect concurrent writes');
    }
    console.log(JSON.stringify({verified:true,columns:fields,existingRowsPreserved:true}));
  }
}catch(error){
  console.error(JSON.stringify({ok:false,status:error?.response?.status||null,message:error?.response?'NJUTable request failed; credentials suppressed':error.message}));
  process.exitCode=1;
}
