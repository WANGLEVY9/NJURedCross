import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresStaffDeclaration,staffEmailDomains} from '../public/app/shared/staff-declaration.js';
import {createAccountRow,accountFromRow} from '../lib/identity/store.js';
import {identityRoutes} from '../lib/identity/api.js';
test('staff domains default empty and match complete normalized suffixes only',()=>{
 assert.equal(requiresStaffDeclaration('x@nju.edu.cn',undefined),false);
 assert.equal(requiresStaffDeclaration('x@nju.edu.cn',['NJU.EDU.CN']),true);
 assert.equal(requiresStaffDeclaration('x@fake-nju.edu.cn',['nju.edu.cn']),false);
 assert.deepEqual(staffEmailDomains(['NJU.EDU.CN','nju.edu.cn','@bad','']),['nju.edu.cn']);
});
test('each declaration persists in the existing private profile JSON without granting roles',async()=>{
 for(const value of ['是','否','未确认']){
  let row;const client={appendRow:async(_table,values)=>{row=values;return {_id:'synthetic'};}};
  await createAccountRow(client,{login:'synthetic',email:'synthetic@example.invalid',passwordHash:'synthetic',role:'member',staffDeclared:value});
  assert.equal(JSON.parse(row['志愿资料']).staffDeclared,value);
  assert.equal(accountFromRow(row).staffDeclared,value);assert.equal(accountFromRow(row).role,'member');
 }
});
test('registration configuration exposes a sanitized staff list and defaults to empty',async()=>{
 const ctx={config:{registrationAvailable:true,smailDomains:['smail.nju.edu.cn']},json:(_res,status,body)=>({status,body})};
 const run=()=>identityRoutes({method:'GET'},null,new URL('http://test/api/auth/registration-config'),ctx);
 assert.deepEqual((await run()).body.staffEmailDomains,[]);
 ctx.config.staffEmailDomains=['NJU.EDU.CN','invalid@value'];assert.deepEqual((await run()).body.staffEmailDomains,['nju.edu.cn']);
});
