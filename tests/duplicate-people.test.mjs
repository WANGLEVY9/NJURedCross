import test from 'node:test';
import assert from 'node:assert/strict';
import {duplicatePeople,duplicatePeopleRoute} from '../lib/identity/duplicate-people.js';
import {validateProfileValues} from '../lib/identity/volunteer-profile.js';
test('duplicate scan allows one exact profile per account and never treats names alone as identity',()=>{
 assert.deepEqual(duplicatePeople([{_id:'a',学号:'000001',真实姓名:'同名'}],[{_id:'p',学号:'000001',姓名:'同名'},{_id:'other',学号:'000002',姓名:'同名'}]),[]);
});
test('duplicate scan reports duplicates within each source and cross-source identity conflicts',()=>{
 const accounts=[{_id:'a',学号:' 000001 ',真实姓名:'合成甲'},{_id:'b',学号:'000001',真实姓名:'合成甲'}];
 const profiles=[{_id:'p',学号:'000001',姓名:'合成乙'},{_id:'q',学号:'000002',姓名:'另一人'},{_id:'r',学号:'000002',姓名:'另一人'}];
 const snapshot=structuredClone([accounts,profiles]),result=duplicatePeople(accounts,profiles);
 assert.equal(result.length,2);assert.equal(result[0].identityConflict,true);assert.equal(result[1].rows.length,2);assert.deepEqual([accounts,profiles],snapshot);
});
test('duplicate scan requires current active verified super role before reading profile data',async()=>{
 for(const role of ['member','platform_admin']){
  let profileReads=0;
  const row={_id:'a',登录名:'actor',密码哈希:'synthetic',账号ID:'a',角色:role,状态:'启用',邮箱已验证:'已验证'};
  const ctx={requireSession:()=>({username:'actor',role:'super_admin'}),getBase:async()=>({listRows:async()=>[row]}),getProfileBase:async()=>{profileReads++;},json:(_res,status,body)=>({status,body})};
  const result=await duplicatePeopleRoute({},null,ctx);assert.equal(result.status,403);assert.equal(profileReads,0);
 }
});
test('certificate collection permits an explicit no and refuses unknown or arbitrary selections',()=>{
 assert.equal(validateProfileValues({certificate:'否'}),'');
 for(const certificate of ['', '未知', '任意内容'])assert.notEqual(validateProfileValues({certificate}),'');
});
