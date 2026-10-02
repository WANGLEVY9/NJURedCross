/** Reversibly redact obsolete identity copies after the private Base is live and verified. */
import {createHmac} from 'node:crypto';
import { Base } from 'seatable-api';
import { mkdir,writeFile } from 'node:fs/promises';
import { ACCOUNT_TABLE,CODE_TABLE,listIdentityRows } from '../lib/identity/store.js';
import { MAIL_TABLE } from '../lib/mailer.js';
const apply=process.argv.includes('--apply');
const server=process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn';
const source=new Base({server,APIToken:process.env.SEATABLE_API_TOKEN});
const target=new Base({server,APIToken:process.env.SEATABLE_IDENTITY_API_TOKEN});
try{
 await Promise.all([source.auth(),target.auth()]);
 if(target.dtableUuid!==process.env.SEATABLE_IDENTITY_BASE_UUID||source.dtableUuid===target.dtableUuid)throw new Error('Private identity target mismatch');
 const rows={};for(const t of [ACCOUNT_TABLE,CODE_TABLE,MAIL_TABLE])rows[t]=await listIdentityRows(source,t);
 rows['操作审计表']=(await listIdentityRows(source,'操作审计表')).filter(r=>String(r['动作']||'').startsWith('identity.'));
 const privateAccounts=await listIdentityRows(target,ACCOUNT_TABLE);
 for(const a of rows[ACCOUNT_TABLE]){const matches=privateAccounts.filter(p=>p['账号ID']===a['账号ID']);if(matches.length!==1||matches[0]['角色']!==a['角色']||(a['密码哈希']&&matches[0]['密码哈希']!==a['密码哈希']))throw new Error('Verified private account required before redaction');}
 console.log(JSON.stringify({mode:apply?'apply':'preview',privateAccountsVerified:true,redactTables:[ACCOUNT_TABLE,CODE_TABLE,MAIL_TABLE],deleteRows:0}));
 if(!apply)process.exit(0);
 const dir=process.env.IDENTITY_MIGRATION_BACKUP_DIR||'.private-identity-schema-backups';await mkdir(dir,{recursive:true,mode:0o700});await writeFile(`${dir}/before-redaction-${Date.now()}.json`,JSON.stringify(rows),{mode:0o600});
 for(const a of rows[ACCOUNT_TABLE]){
  const fields=['登录名','邮箱','密码哈希','显示名','真实姓名','学号','手机号','院系','年级','备注'];
  await source.updateRow(ACCOUNT_TABLE,a._id,Object.fromEntries(fields.filter(f=>f in a).map(f=>[f,''])));
 }
 for(const r of rows[CODE_TABLE])await source.updateRow(CODE_TABLE,r._id,{邮箱:'',验证码哈希:'',IP:'',状态:'已迁移'});
 for(const r of rows[MAIL_TABLE])await source.updateRow(MAIL_TABLE,r._id,{收件人:'',错误:''});
 const ref=value=>privateAccounts.find(a=>a['登录名']===value)?.['账号ID']||(/^(ACC-|REF-)/.test(value)?value:'REF-'+createHmac('sha256',process.env.PLATFORM_SESSION_SECRET).update(String(value||'')).digest('base64url').slice(0,24));
 for(const row of rows['操作审计表'])await source.updateRow('操作审计表',row._id,{操作人:ref(row['操作人']),对象:ref(row['对象']),IP:ref(row['IP'])});
 const accounts=await listIdentityRows(source,ACCOUNT_TABLE);
 if(accounts.some(a=>a['密码哈希']||a['邮箱']||a['登录名']))throw new Error('Business identity redaction verification failed');
 console.log(JSON.stringify({redacted:true,rowsPreserved:true,privateBackup:true}));
}catch(e){console.error(JSON.stringify({ok:false,status:e.response?.status||null,message:e.response?'Identity retirement request failed; credentials suppressed':e.message}));process.exitCode=1;}
