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

/* --------- 宣传审核待办汇总：0..N 个投稿附件 --------- */

const digestKind = 'outreach.digest.liaison';
const digestItem = (extra = {}) => ({
  filename: '1-正文.docx',
  content: Buffer.from('synthetic'),
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ...extra,
});

test('digest 邮件允许多个附件，未知类型降级为二进制流并保留附件 ID', () => {
  const out = mailAttachments({
    kind: digestKind,
    attachments: [
      digestItem({ attachmentId: 'ATT-1' }),
      digestItem({ filename: '2-图.png', contentType: 'text/html', attachmentId: 'ATT-2' }),
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].attachmentId, 'ATT-1');
  // 投稿人声明什么类型都可能；text/html 不能原样进审核人邮箱。
  assert.equal(out[1].contentType, 'application/octet-stream');
  assert.equal(out[1].filename, '2-图.png');
});

test('digest 邮件附件受个数、单文件、总大小、路径与未知字段约束', () => {
  const many = Array.from({ length: 31 }, (_, i) => digestItem({ filename: `${i}.png`, contentType: 'image/png' }));
  assert.throws(() => mailAttachments({ kind: digestKind, attachments: many }), /邮件附件无效/);

  const tooBig = Buffer.alloc(8 * 1024 * 1024 + 1);
  assert.throws(() => mailAttachments({ kind: digestKind, attachments: [digestItem({ content: tooBig })] }), /邮件附件无效/);

  const seven = Buffer.alloc(7 * 1024 * 1024);
  assert.throws(() => mailAttachments({
    kind: digestKind,
    attachments: [digestItem({ content: seven }), digestItem({ content: seven }), digestItem({ content: seven })],
  }), /邮件附件无效/);

  assert.throws(() => mailAttachments({ kind: digestKind, attachments: [digestItem({ filename: '../x.docx' })] }), /邮件附件无效/);
  assert.throws(() => mailAttachments({ kind: digestKind, attachments: [digestItem({ path: '/etc' })] }), /邮件附件无效/);
  assert.throws(() => mailAttachments({ kind: digestKind, attachments: [] }), /邮件附件无效/);
});

test('digest 附件参与邮件指纹：内容或名字变了就不能复用同一个幂等键', () => {
  const options = { secret: 's'.repeat(32) };
  const message = {
    to: 'synthetic@example.test',
    subject: '宣传待办·早间汇总',
    text: '待办',
    kind: digestKind,
    idempotencyKey: 'outreach-digest-2026-11-13-08-synthetic',
    attachments: [digestItem({ attachmentId: 'ATT-1' })],
  };
  const before = createMailIntent(message, options);
  assert.equal(createMailIntent(message, options).fingerprint, before.fingerprint);
  assert.notEqual(
    createMailIntent({ ...message, attachments: [digestItem({ attachmentId: 'ATT-1', content: Buffer.from('changed') })] }, options).fingerprint,
    before.fingerprint,
  );
  assert.notEqual(
    createMailIntent({ ...message, attachments: [digestItem({ attachmentId: 'ATT-1', filename: '1-改名.docx' })] }, options).fingerprint,
    before.fingerprint,
  );
});
