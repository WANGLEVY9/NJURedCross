import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });
import {readFile,writeFile,mkdir,rename,unlink,realpath} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {grantLocalDeveloperAccess} from '../lib/identity/local-developer-access.js';

const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const apply=process.argv.includes('--apply');
const root=fileURLToPath(new URL('../',import.meta.url));
const input=arg('accounts-file');
if(process.env.NODE_ENV==='production')throw Error('本脚本仅用于本地开发账号；线上请使用 set-account-role.mjs');
if(!input)throw Error('必须明确指定 --accounts-file，不能隐式更改账号源');
const path=await realpath(resolve(input));
const source=await readFile(path,'utf8');
const result=grantLocalDeveloperAccess(JSON.parse(source),{account:arg('account'),expectedName:arg('expect-name')});
let backup;
if(apply){
  const backupDir=join(root,'.write-state','local-account-backups');
  await mkdir(backupDir,{recursive:true,mode:0o700});
  backup=join(backupDir,`${randomUUID()}.json`);
  await writeFile(backup,source,{mode:0o600,flag:'wx'});
  const temporary=join(dirname(path),`.local-account-${randomUUID()}.tmp`);
  try{
    await writeFile(temporary,JSON.stringify(result.accounts,null,2)+'\n',{mode:0o600,flag:'wx'});
    if(await readFile(path,'utf8')!==source)throw Error('账号文件已被其他进程修改，请重新预览');
    await rename(temporary,path);
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  const fresh=grantLocalDeveloperAccess(JSON.parse(await readFile(path,'utf8')),{account:arg('account'),expectedName:arg('expect-name')});
  if(fresh.previousRole!=='super_admin')throw Error('授权回读校验失败');
}
console.log(JSON.stringify({applied:apply,previousRole:result.previousRole,role:result.account.role,backup,restartRequired:apply,note:'仅修改指定本地账号文件；若已配置身份 Base，登录使用身份库而非此文件。线上角色变化后须重新登录。'}));
