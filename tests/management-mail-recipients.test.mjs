import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liaisonMailRecipients} from '../lib/attachment/liaison-mail-recipients.js';
import {buildDigest,mergeDigestRecipients,sendDigest,digestSlot} from '../lib/attachment/digest.js';
import {authorizeReviewStep} from '../lib/attachment/review-policy.js';
import {findReimbursementReviewer} from '../lib/reimbursements/reviewer-source.js';

const campus='999990001@smail.nju.edu.cn',preferred='synthetic-notify@example.invalid';
const account={accountId:'synthetic-manager',email:campus,notificationEmail:preferred,emailVerified:true,status:'启用'};
const liaison={对接人ID:'synthetic-liaison',姓名:'合成负责人',负责栏目:'活动预热',角色:'对接人',邮箱:campus,启用:'是'};
const submission={投稿ID:'synthetic-post',标题:'合成活动',类别:'文字稿件',推文类别:'活动预热',审核状态:'待审核',审核层级:'0',审核轨迹:'[]',来源:'公众投稿'};

test('management digest delivers to the current preference, merges with activity tasks, and retains review identity',async()=>{
 const rows=[{...liaison}],before=structuredClone(rows);
 const mailRows=liaisonMailRecipients(rows,[account]);
 assert.deepEqual(rows,before);
 assert.doesNotThrow(()=>authorizeReviewStep({category:'文字稿件',articleCategory:'活动预热',status:'待审核'},account,rows));
 assert.throws(()=>authorizeReviewStep({category:'文字稿件',articleCategory:'活动预热',status:'待审核'},{...account,email:preferred},rows),{statusCode:403});
 const recipients=mergeDigestRecipients(buildDigest({rows:[submission],assignees:mailRows}),[
  {email:preferred,name:'合成负责人',roles:['activity-owner'],items:[{id:'synthetic-activity',type:'activity',title:'合成活动',count:1}]},
 ]);
 assert.equal(recipients.length,1);assert.equal(recipients[0].email,preferred);assert.equal(recipients[0].items.length,2);
 const sent=[];
 await sendDigest({mail:async message=>{sent.push(message);return {ok:true};},recipients,slot:digestSlot(new Date('2026-11-17T00:00:00Z')),baseUrl:'https://example.invalid'});
 assert.equal(sent.length,1);assert.equal(sent[0].to,preferred);
 assert.ok(!sent[0].idempotencyKey.includes(campus));
 const changed=liaisonMailRecipients(rows,[{...account,notificationEmail:'changed@example.invalid'}]);
 assert.equal(changed[0].邮箱,'changed@example.invalid');
});

test('liaison preferences fall back safely without name-based or delivery-address identity matching',()=>{
 for(const notificationEmail of ['',undefined,'invalid','bad@example.invalid\r\nBcc: other@example.invalid']){
  assert.equal(liaisonMailRecipients([liaison],[{...account,notificationEmail}])[0].邮箱,campus);
 }
 assert.equal(liaisonMailRecipients([liaison],[{...account,email:'someone-else@example.invalid',realName:liaison.姓名}])[0].邮箱,campus);
 assert.equal(liaisonMailRecipients([liaison],[{...account,email:'someone-else@example.invalid',notificationEmail:campus}])[0].邮箱,campus);
 for(const accounts of [[{...account,status:'停用'}],[{...account,emailVerified:false}],[account,{...account,accountId:'duplicate'}]]){
  assert.equal(liaisonMailRecipients([liaison],accounts)[0].邮箱,'');
 }
 assert.equal(liaisonMailRecipients([{...liaison,邮箱:''}],[account])[0].邮箱,'');
});

test('finance reviewer mail uses the preference while keeping exact identity, verification and status checks',async()=>{
 let rows=[{账号ID:'synthetic-reviewer',真实姓名:'合成审核人',邮箱:campus,收信邮箱:preferred,邮箱已验证:'已验证',状态:'启用'}];
 const client={query:async()=>rows};
 const read=()=>findReimbursementReviewer(client,'synthetic-reviewer','合成审核人');
 assert.equal((await read()).email,preferred);
 for(const value of ['', 'invalid']){rows[0].收信邮箱=value;assert.equal((await read()).email,campus);}
 rows[0].收信邮箱=preferred;
 assert.equal(await findReimbursementReviewer(client,'synthetic-reviewer','其他人'),null);
 rows[0].邮箱已验证='未验证';assert.equal(await read(),null);
 rows[0].邮箱已验证='已验证';rows[0].状态='停用';assert.equal(await read(),null);
 rows[0].状态='启用';rows=[rows[0],{...rows[0]}];assert.equal(await read(),null);
});
