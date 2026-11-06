import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

/** Durable management decisions independent of regenerated source rows. */
export function createActivityLifecycleStore(file=':memory:'){
 if(file!==':memory:'){if(!isAbsolute(file))throw Error('活动状态存储需要绝对路径');mkdirSync(dirname(file),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS activity_lifecycle (project_key TEXT PRIMARY KEY, receipt TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS source_registration (project_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, decision TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS activity_registration_contact (project_key TEXT PRIMARY KEY, contact TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS activity_workspace_edits (event_id TEXT NOT NULL, token TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(event_id,token))');
 if(file!==':memory:')chmodSync(file,0o600);
 db.exec('CREATE TABLE IF NOT EXISTS activity_information_corrections (project_key TEXT PRIMARY KEY, content TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS activity_evidence_secrets (purpose TEXT PRIMARY KEY, secret TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS activity_manual_hours_requests (request_id TEXT PRIMARY KEY, content TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS activity_final_hours_states (event_id TEXT NOT NULL, state_ref TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY(event_id,state_ref))');
 db.exec('CREATE TABLE IF NOT EXISTS activity_final_hours_refs (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, state_ref TEXT NOT NULL, UNIQUE(event_id,state_ref))');
 const registration=(key,fallback={enabled:true,revision:0})=>{const row=db.prepare('SELECT decision FROM source_registration WHERE project_key=?').get(key);return row?JSON.parse(row.decision):fallback;};
 let manualSecret;
 return {
  finalHoursState(eventId,reference){
   if(Number.isSafeInteger(reference)&&reference>0){const alias=db.prepare('SELECT state_ref FROM activity_final_hours_refs WHERE event_id=? AND id=?').get(eventId,reference);if(!alias)return null;reference=alias.state_ref;}
   const row=db.prepare('SELECT content FROM activity_final_hours_states WHERE event_id=? AND state_ref=?').get(eventId,reference);
   if(!row)return null;
   if(createHash('sha256').update(row.content).digest('hex')!==reference)throw Object.assign(Error('最终时长归档状态校验失败，请恢复私有状态备份'),{statusCode:503});
   return JSON.parse(row.content);
  },
  saveFinalHoursState(eventId,state,{compact=false}={}){
   const content=JSON.stringify(state),reference=createHash('sha256').update(content).digest('hex');
   db.prepare('INSERT OR IGNORE INTO activity_final_hours_states(event_id,state_ref,content) VALUES(?,?,?)').run(eventId,reference,content);
   if(!this.finalHoursState(eventId,reference))throw Object.assign(Error('最终时长归档状态未确认'),{statusCode:503});
   if(!compact)return reference;
   db.prepare('INSERT OR IGNORE INTO activity_final_hours_refs(event_id,state_ref) VALUES(?,?)').run(eventId,reference);
   const id=Number(db.prepare('SELECT id FROM activity_final_hours_refs WHERE event_id=? AND state_ref=?').get(eventId,reference).id);
   if(!Number.isSafeInteger(id)||!this.finalHoursState(eventId,id))throw Object.assign(Error('最终时长状态引用未确认'),{statusCode:503});
   return id;
  },
  manualHoursRequest(id){const row=db.prepare('SELECT content FROM activity_manual_hours_requests WHERE request_id=?').get(id);return row?JSON.parse(row.content):null;},
  saveManualHoursRequest(request){
   db.prepare('INSERT OR IGNORE INTO activity_manual_hours_requests(request_id,content) VALUES(?,?)').run(request.requestId,JSON.stringify(request));
   const stored=JSON.parse(db.prepare('SELECT content FROM activity_manual_hours_requests WHERE request_id=?').get(request.requestId).content);
   if(stored.fingerprint!==request.fingerprint||stored.eventId!==request.eventId)throw Object.assign(Error('补录请求内容冲突，请重新核对'),{statusCode:409});return stored;
  },
  manualHoursSecret(){
   if(manualSecret)return manualSecret;
   let row=db.prepare('SELECT secret FROM activity_evidence_secrets WHERE purpose=?').get('manual-hours-v1');
   if(!row){db.prepare('INSERT OR IGNORE INTO activity_evidence_secrets(purpose,secret) VALUES(?,?)').run('manual-hours-v1',randomBytes(32).toString('hex'));row=db.prepare('SELECT secret FROM activity_evidence_secrets WHERE purpose=?').get('manual-hours-v1');}
   if(!/^[a-f0-9]{64}$/.test(row?.secret||''))throw Object.assign(Error('补录核验密钥不可用，请联系管理员'),{statusCode:503});manualSecret=row.secret;return manualSecret;
  },
  information(key){const row=db.prepare('SELECT content FROM activity_information_corrections WHERE project_key=?').get(key);return row?JSON.parse(row.content):null;},
  setInformation(key,content){db.prepare('INSERT INTO activity_information_corrections(project_key,content) VALUES(?,?) ON CONFLICT(project_key) DO UPDATE SET content=excluded.content').run(key,JSON.stringify(content));},
  workspaceEdit(eventId,token){const row=db.prepare('SELECT receipt FROM activity_workspace_edits WHERE event_id=? AND token=?').get(eventId,token);return row?JSON.parse(row.receipt):null;},
  saveWorkspaceEdit(eventId,receipt){
   const json=JSON.stringify(receipt);
   db.prepare('INSERT OR IGNORE INTO activity_workspace_edits(event_id,token,receipt) VALUES(?,?,?)').run(eventId,receipt.token,json);
   const stored=db.prepare('SELECT receipt FROM activity_workspace_edits WHERE event_id=? AND token=?').get(eventId,receipt.token);
   if(stored.receipt!==json)throw Object.assign(Error('活动修改回执冲突，请核对原保存结果'),{statusCode:409,code:'workspace_edit_conflict'});
  },
  registration,
  contact(key){const row=db.prepare('SELECT contact FROM activity_registration_contact WHERE project_key=?').get(key);return row?JSON.parse(row.contact):null;},
  setContact(key,contact){db.prepare('INSERT INTO activity_registration_contact(project_key,contact) VALUES(?,?) ON CONFLICT(project_key) DO UPDATE SET contact=excluded.contact').run(key,JSON.stringify(contact));},
  setRegistration(key,{enabled,revision,actor,at,defaultEnabled=true,targets=[]}){
   db.exec('BEGIN IMMEDIATE');
   try{
    const current=registration(key,{enabled:defaultEnabled,revision:0});
    const children=[...new Set(targets)].map(target=>[target,registration(target,{enabled:current.enabled,revision:0})]);
    // A retry is safe only when the entire requested scope already matches.
    if(current.enabled===enabled&&children.every(([,decision])=>decision.enabled===enabled)){db.exec('COMMIT');return current;}
    if(current.revision!==revision)throw Object.assign(Error('报名开关已变化，请刷新后重试'),{statusCode:409});
    const persist=(target,previous)=>{
     const decision={enabled,revision:previous.revision+1,actor,at};
     db.prepare('INSERT INTO source_registration(project_key,revision,decision) VALUES(?,?,?) ON CONFLICT(project_key) DO UPDATE SET revision=excluded.revision,decision=excluded.decision').run(target,decision.revision,JSON.stringify(decision));
     return decision;
    };
    const decision=persist(key,current);
    for(const [target,previous] of children)persist(target,previous);
    db.exec('COMMIT');return decision;
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  /** Several independent session keys in one transaction. Selection batches have
   * no single revision to compare, so the server reads each current revision
   * inside the transaction; the queue already serialises these writes. */
  setRegistrationMany(keys,{enabled,actor,at}={}){
   const targets=[...new Set(keys)];
   if(!targets.length)throw Object.assign(Error('请先选择要调整的场次'),{statusCode:400});
   db.exec('BEGIN IMMEDIATE');
   try{
    let revision=0;
    for(const target of targets){
     const previous=registration(target,{enabled:true,revision:0});
     if(previous.enabled===enabled){revision=Math.max(revision,previous.revision);continue;}
     const decision={enabled,revision:previous.revision+1,actor,at};
     db.prepare('INSERT INTO source_registration(project_key,revision,decision) VALUES(?,?,?) ON CONFLICT(project_key) DO UPDATE SET revision=excluded.revision,decision=excluded.decision').run(target,decision.revision,JSON.stringify(decision));
     revision=Math.max(revision,decision.revision);
    }
    db.exec('COMMIT');return {enabled,revision};
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  bloodArchives(){return db.prepare("SELECT project_key,receipt FROM activity_lifecycle WHERE project_key LIKE 'blood:%:hours-archive'").all().map(row=>({key:row.project_key,receipt:JSON.parse(row.receipt)}));},
  get(key){const row=db.prepare('SELECT receipt FROM activity_lifecycle WHERE project_key=?').get(key);return row?JSON.parse(row.receipt):null;},
  save(key,receipt){
   const json=JSON.stringify(receipt);db.prepare('INSERT OR IGNORE INTO activity_lifecycle(project_key,receipt) VALUES(?,?)').run(key,json);
   const stored=db.prepare('SELECT receipt FROM activity_lifecycle WHERE project_key=?').get(key);
   if(stored.receipt!==json)throw Object.assign(Error('活动已由其他操作结束，请刷新核对'),{statusCode:409});
  },
  close:()=>db.close(),
 };
}
