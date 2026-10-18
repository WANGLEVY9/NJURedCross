import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailIntent} from '../lib/mail/intent.js';
import {mailAttachments} from '../lib/mail/attachments.js';
test('hours attachments bind exact bytes and filename to durable mail identity and never accept paths',()=>{
 const message={to:'synthetic@example.test',subject:'合成最终表',text:'录入提醒',kind:'workflow-hours',idempotencyKey:'synthetic-hours',attachments:[{filename:'合成.xlsx',content:Buffer.from('synthetic'),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]},options={secret:'s'.repeat(32)};
 const before=createMailIntent(message,options);assert.equal(createMailIntent(message,options).fingerprint,before.fingerprint);
 assert.notEqual(createMailIntent({...message,attachments:[{...message.attachments[0],content:Buffer.from('changed')}]},options).fingerprint,before.fingerprint);
 const copy=mailAttachments(message);message.attachments[0].content[0]=0;assert.notEqual(copy[0].content[0],0);
 for(const item of [{filename:'../unsafe.xlsx'},{path:'secret'},{contentType:'text/html'}])assert.throws(()=>createMailIntent({...message,attachments:[{...message.attachments[0],...item}]},options),{statusCode:400});
 assert.throws(()=>createMailIntent({...message,kind:'security'},options),{statusCode:400});
 assert.throws(()=>createMailIntent({...message,attachments:undefined},options),{statusCode:400});
});
