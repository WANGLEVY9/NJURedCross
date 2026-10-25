import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {grantLocalDeveloperAccess} from '../lib/identity/local-developer-access.js';
import {organizationAuthority} from '../lib/events/organization-authority.js';
import {hasPermission,CONSOLE_PERMISSION_SCOPES} from '../lib/permissions.js';
import {ACTIVITY_CATEGORY_OPTIONS} from '../public/app/shared/activity-taxonomy.js';

const account={accountId:'synthetic-dev',username:'dev@example.test',realName:'合成开发者',role:'member',status:'启用',emailVerified:true,passwordHash:'synthetic-secret'};
const options={account:account.accountId,expectedName:account.realName};

test('exact verified account receives all scopes and event creation/management without changing other identities',async()=>{
  const other={...account,accountId:'other',username:'other@example.test'};
  const input=[account,other];
  const result=grantLocalDeveloperAccess(input,options);
  assert.equal(input[0].role,'member');
  assert.equal(result.accounts[1],other);
  assert.equal(result.account.passwordHash,account.passwordHash);
  for(const scope of CONSOLE_PERMISSION_SCOPES)assert.equal(hasPermission(result.account,scope),true);
  const events=ACTIVITY_CATEGORY_OPTIONS.map((category,index)=>({_id:`event-${index}`,组织类别:category}));
  const authority=await organizationAuthority(result.account,{query:()=>assert.fail('super administrator needs no organization lookup')},events);
  assert.equal(authority.global,true);
  for(const event of events){
    authority.assertEvent(event._id);
    if(event.组织类别!=='献血车专项')authority.assertCreate({center:event.组织类别});
  }
  assert.deepEqual(grantLocalDeveloperAccess(result.accounts,options).accounts,result.accounts);
});

test('name alone, duplicate identity, name mismatch, disabled and unverified accounts are rejected',()=>{
  assert.throws(()=>grantLocalDeveloperAccess([account],{...options,account:account.realName}));
  assert.throws(()=>grantLocalDeveloperAccess([account,{...account}],options));
  assert.throws(()=>grantLocalDeveloperAccess([account],{...options,expectedName:'其他人'}));
  assert.throws(()=>grantLocalDeveloperAccess([{...account,status:'停用'}],options));
  assert.throws(()=>grantLocalDeveloperAccess([{...account,emailVerified:false}],options));
});

test('local maintenance preview is read-only; coordinated apply preserves credentials and creates a private backup',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'local-developer-'));
  const path=join(dir,'accounts.json');
  const original=JSON.stringify([account]);
  const run=promisify(execFile);
  const args=['scripts/run-coordinated-script.mjs','grant-local-developer-access.mjs',`--accounts-file=${path}`,`--account=${account.accountId}`,`--expect-name=${account.realName}`];
  const env={...process.env,NODE_ENV:'test',PLATFORM_WRITE_STATE_DIR:dir};
  let backup;
  try{
    await writeFile(path,original);
    const preview=await run(process.execPath,args,{env});
    assert.equal(JSON.parse(preview.stdout).applied,false);
    assert.equal(await readFile(path,'utf8'),original);
    const applied=await run(process.execPath,[...args,'--apply'],{env});
    const receipt=JSON.parse(applied.stdout);backup=receipt.backup;
    assert.equal(receipt.applied,true);
    assert.equal(await readFile(backup,'utf8'),original);
    const fresh=JSON.parse(await readFile(path,'utf8'))[0];
    assert.equal(fresh.role,'super_admin');
    assert.equal(fresh.passwordHash,account.passwordHash);
    assert.equal(applied.stdout.includes(account.passwordHash),false);
  }finally{
    if(backup)await rm(backup,{force:true});
    await rm(dir,{recursive:true,force:true});
  }
});
