import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowParticipant} from '../lib/events/participant.js';
test('verified campus administrators may participate with mailbox ID without changing stored identity',()=>{
 for(const role of ['platform_admin','super_admin']){
  const account={role,accountId:'synthetic',email:'999990001@smail.nju.edu.cn',emailVerified:true,realName:'合成同学',studentId:''};
  const participant=workflowParticipant(account);assert.equal(participant.studentId,'999990001');assert.equal(account.studentId,'');assert.equal(participant.role,role);
 }
});
test('unverified, external, unnamed or ordinary accounts never get inferred identities',()=>{
 const base={role:'super_admin',email:'999990001@smail.nju.edu.cn',emailVerified:true,realName:'合成同学',studentId:''};
 for(const patch of [{role:'member'},{emailVerified:false},{realName:''},{email:'999990001@example.org'},{email:'staff@nju.edu.cn'}]){
  const account={...base,...patch};assert.equal(workflowParticipant(account),account);
 }
 assert.equal(workflowParticipant(null),null);
});
test('an existing conflicting student ID remains untouched for the registration validator to reject',()=>{
 const account={role:'super_admin',email:'999990001@smail.nju.edu.cn',emailVerified:true,realName:'合成同学',studentId:'999990002'};
 assert.equal(workflowParticipant(account),account);
});
