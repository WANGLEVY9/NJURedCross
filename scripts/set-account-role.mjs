import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });
/** Operator-only role maintenance; tokens stay in the server environment. */
import {Base} from 'seatable-api';
import {ACCOUNT_TABLE,listIdentityRows} from '../lib/identity/store.js';
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const target=arg('account'),role=arg('role');
if(!target||!['member','platform_admin','super_admin'].includes(role))throw Error('Specify --account and --role=member|platform_admin|super_admin');
const token=process.env.SEATABLE_IDENTITY_API_TOKEN,uuid=process.env.SEATABLE_IDENTITY_BASE_UUID;
if(!token||!uuid)throw Error('Separate identity Base required');
const base=new Base({server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',APIToken:token});
await base.auth();if(base.dtableUuid!==uuid)throw Error('Identity Base mismatch');
const rows=await listIdentityRows(base,ACCOUNT_TABLE);
const matches=rows.filter(r=>r['登录名']===target||r['邮箱']===target);
if(matches.length!==1)throw Error('Account match must be unique');
const row=matches[0],previous=row['角色'];
if(role!=='member'&&(row['状态']!=='启用'||row['邮箱已验证']!=='已验证'))throw Error('Administrator promotion requires an active verified account');
if(previous==='super_admin'&&role!=='super_admin'&&!rows.some(r=>r._id!==row._id&&r['角色']==='super_admin'&&r['状态']==='启用'))throw Error('Cannot remove the last active super administrator');
const apply=process.argv.includes('--apply');
if(apply&&previous!==role){
 const note=`${String(row['备注']||'')}\n[角色维护 ${new Date().toISOString()}] ${previous} → ${role}（服务器操作员）`.trim();
 await base.updateRow(ACCOUNT_TABLE,row._id,{角色:role,备注:note});
 const fresh=(await listIdentityRows(base,ACCOUNT_TABLE)).find(r=>r._id===row._id);
 if(fresh?.['角色']!==role)throw Error('Role write verification failed');
}
console.log(JSON.stringify({account:target,previous,role,applied:apply,changed:apply&&previous!==role,reloginRequired:apply&&previous!==role}));
