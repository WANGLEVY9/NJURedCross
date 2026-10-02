/** Add private profile/mapping columns only. Never copy or rewrite student rows. */
import { Base } from 'seatable-api';
import { mkdir, writeFile } from 'node:fs/promises';
import { ACCOUNT_TABLE } from '../lib/identity/store.js';
import { BINDING_TABLE } from '../lib/identity/api.js';
import { PROFILE_BINDING_COLUMNS } from '../lib/identity/volunteer-profile.js';
const apply=process.argv.includes('--apply');
try {
  const base=new Base({server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',APIToken:process.env.SEATABLE_IDENTITY_API_TOKEN});
  await base.auth();if(base.dtableUuid!==process.env.SEATABLE_IDENTITY_BASE_UUID)throw Error('Private Base mismatch');
  const metadata=await base.getMetadata();
  const plan=[{name:ACCOUNT_TABLE,columns:['志愿资料']},{name:BINDING_TABLE,columns:PROFILE_BINDING_COLUMNS}];
  for(const item of plan) {
    const table=metadata.tables.find(t=>t.name===item.name);if(!table)throw Error('Required private table missing');
    if(item.columns.some(n=>table.columns.some(c=>c.name===n&&c.type!=='text')))throw Error('Existing column type mismatch');
    item.columns=item.columns.filter(n=>!table.columns.some(c=>c.name===n));
  }
  console.log(JSON.stringify({mode:apply?'apply':'preview',plan,rowWrites:0,volunteerSchemaWrites:0}));
  if(apply){
    await mkdir('.private-identity-schema-backups',{recursive:true,mode:0o700});
    await writeFile(`.private-identity-schema-backups/profile-map-${Date.now()}.json`,JSON.stringify(metadata),{mode:0o600});
    for(const item of plan)for(const name of item.columns)await base.insertColumn(item.name,name,'text','');
    const after=await base.getMetadata();
    if(plan.some(p=>p.columns.some(n=>!after.tables.find(t=>t.name===p.name).columns.some(c=>c.name===n&&c.type==='text'))))throw Error('Schema verification failed');
    console.log(JSON.stringify({verified:true,rowWrites:0}));
  }
}catch{console.error('Private profile schema operation failed; sensitive details suppressed');process.exitCode=1;}
