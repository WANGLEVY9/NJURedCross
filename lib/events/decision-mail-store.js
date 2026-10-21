import {DatabaseSync} from 'node:sqlite';
import {mkdir,chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

const KINDS=new Set(['confirm','reject','leave','participation']);
const TRANSITIONS={pending:new Set(['sending','cancelled','unknown']),sending:new Set(['sent','pending','unknown','failed']),sent:new Set(),cancelled:new Set(),unknown:new Set(),failed:new Set()};
const conflict=()=>Object.assign(Error('Decision mail operation identity or state conflict'),{code:'decision_mail_conflict'});

export function normalizeDecisionItem(item){
 if(!item||!KINDS.has(item.kind)||typeof item.id!=='string'||!item.id.trim()||item.id.length>200)throw conflict();
 const result={kind:item.kind,id:item.id};
 if(item.kind==='participation'){
  if(typeof item.requestAt!=='string'||item.requestAt.length>100||!Number.isFinite(Date.parse(item.requestAt)))throw conflict();
  result.requestAt=item.requestAt;
 }
 if(item.kind==='leave'){
  if(typeof item.requestAt!=='string'||item.requestAt.length>100||!Number.isFinite(Date.parse(item.requestAt))||typeof item.approved!=='boolean'||typeof item.reason!=='string'||!item.reason.trim()||item.reason.trim().length>500)throw conflict();
  Object.assign(result,{requestAt:item.requestAt,approved:item.approved,reason:item.reason.trim()});
 }else if(item.kind==='reject'&&Object.hasOwn(item,'reason')){
  if(typeof item.reason!=='string'||item.reason.trim().length>500)throw conflict();
  result.reason=item.reason.trim();
 }
 return result;
}
export function decisionOperationKey(item){
 const value=normalizeDecisionItem(item);
 return createHash('sha256').update(JSON.stringify([value.kind,value.id,value.requestAt??null,value.approved??null])).digest('hex');
}

export async function openDecisionMailStore(file,{secret}={}){
 if(!(typeof secret==='string'&&secret.length>=32)&&!(Buffer.isBuffer(secret)&&secret.length>=32))throw Error('Decision mail encryption secret must be at least 32 characters');
 const encryptionKey=createHash('sha256').update('decision-mail-payload-v1\0').update(secret).digest();
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 const db=new DatabaseSync(file);
 function encrypt(key,payload){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);
  cipher.setAAD(Buffer.from(key));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')});
 }
 function decrypt(key,encoded){
  const value=JSON.parse(encoded);
  if(value.v!==1||typeof value.iv!=='string'||typeof value.tag!=='string'||typeof value.data!=='string')throw conflict();
  const iv=Buffer.from(value.iv,'base64'),tag=Buffer.from(value.tag,'base64');
  if(iv.length!==12||tag.length!==16)throw conflict();
  const cipher=createDecipheriv('aes-256-gcm',encryptionKey,iv);
  cipher.setAAD(Buffer.from(key));cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'));
 }
 function get(key){
  const row=db.prepare('SELECT * FROM decision_mail_operations WHERE operation_key=?').get(key);
  if(!row)return null;
  const payload=decrypt(key,row.payload_json),item=normalizeDecisionItem(payload.item);
  if(decisionOperationKey(item)!==key||JSON.stringify(item)!==JSON.stringify(payload.item)||!Object.hasOwn(TRANSITIONS,row.state)||!Number.isSafeInteger(row.attempts)||row.attempts<0||!Number.isSafeInteger(row.next_attempt_at)||row.next_attempt_at<0)throw conflict();
  if(payload.message!==null&&(!payload.message||typeof payload.message.to!=='string'||typeof payload.message.text!=='string'||typeof payload.message.subject!=='string'||typeof payload.message.idempotencyKey!=='string'))throw conflict();
  return {key,item,message:payload.message,state:row.state,attempts:row.attempts,nextAttemptAt:row.next_attempt_at,createdAt:row.created_at,updatedAt:row.updated_at};
 }
 try{
  await chmod(file,0o600);
  db.exec(`PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS decision_mail_operations (
    operation_key TEXT PRIMARY KEY,payload_json TEXT NOT NULL,state TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL
   );`);
  const first=db.prepare('SELECT operation_key FROM decision_mail_operations LIMIT 1').get();
  if(first)get(first.operation_key);
  db.prepare("UPDATE decision_mail_operations SET state='unknown',updated_at=? WHERE state='sending'").run(new Date().toISOString());
 }catch(error){db.close();throw error;}
 return {
  get,
  create(input){
   const item=normalizeDecisionItem(input),key=decisionOperationKey(item),stamp=new Date().toISOString();
   const result=db.prepare("INSERT INTO decision_mail_operations(operation_key,payload_json,state,created_at,updated_at) VALUES (?,?,'pending',?,?) ON CONFLICT(operation_key) DO NOTHING").run(key,encrypt(key,{item,message:null}),stamp,stamp);
   const stored=get(key);
   if(JSON.stringify(stored.item)!==JSON.stringify(item))throw conflict();
   return {...stored,created:result.changes===1};
  },
  transition(key,expected,next,{message,nextAttemptAt}={}){
   if(!TRANSITIONS[expected]?.has(next))throw conflict();
   const entry=get(key);if(!entry||entry.state!==expected)throw conflict();
   const payload={item:entry.item,message:message??entry.message};
   if(entry.message&&message&&JSON.stringify(entry.message)!==JSON.stringify(message))throw conflict();
   const due=nextAttemptAt??entry.nextAttemptAt;
   if(!Number.isSafeInteger(due)||due<0)throw conflict();
   const result=db.prepare('UPDATE decision_mail_operations SET payload_json=?,state=?,attempts=?,next_attempt_at=?,updated_at=? WHERE operation_key=? AND state=?').run(encrypt(key,payload),next,entry.attempts+(next==='sending'?1:0),due,new Date().toISOString(),key,expected);
   if(result.changes!==1)throw conflict();
   return get(key);
  },
  defer(key,nextAttemptAt){
   if(!Number.isSafeInteger(nextAttemptAt)||nextAttemptAt<0)throw conflict();
   const result=db.prepare("UPDATE decision_mail_operations SET next_attempt_at=?,updated_at=? WHERE operation_key=? AND state='pending'").run(nextAttemptAt,new Date().toISOString(),key);
   if(result.changes!==1)throw conflict();
   return get(key);
  },
  pending({now=Date.now(),limit=100}={}){
   if(!Number.isSafeInteger(now)||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw conflict();
   return db.prepare("SELECT operation_key FROM decision_mail_operations WHERE state='pending' AND next_attempt_at<=? ORDER BY created_at,operation_key LIMIT ?").all(now,limit).map(row=>get(row.operation_key));
  },
  nextAttemptAt(){return db.prepare("SELECT MIN(next_attempt_at) AS due FROM decision_mail_operations WHERE state='pending'").get().due??null;},
  info(){return Object.fromEntries(db.prepare('SELECT state,COUNT(*) AS count FROM decision_mail_operations GROUP BY state').all().map(row=>[row.state,row.count]));},
  close(){db.close();},
 };
}
