import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

/** Durable management decisions independent of regenerated source rows. */
export function createActivityLifecycleStore(file=':memory:'){
 if(file!==':memory:'){if(!isAbsolute(file))throw Error('活动状态存储需要绝对路径');mkdirSync(dirname(file),{recursive:true});}
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS activity_lifecycle (project_key TEXT PRIMARY KEY, receipt TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS source_registration (project_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, decision TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS activity_registration_contact (project_key TEXT PRIMARY KEY, contact TEXT NOT NULL)');
 const registration=(key,fallback={enabled:true,revision:0})=>{const row=db.prepare('SELECT decision FROM source_registration WHERE project_key=?').get(key);return row?JSON.parse(row.decision):fallback;};
 return {
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
  get(key){const row=db.prepare('SELECT receipt FROM activity_lifecycle WHERE project_key=?').get(key);return row?JSON.parse(row.receipt):null;},
  save(key,receipt){
   const json=JSON.stringify(receipt);db.prepare('INSERT OR IGNORE INTO activity_lifecycle(project_key,receipt) VALUES(?,?)').run(key,json);
   const stored=db.prepare('SELECT receipt FROM activity_lifecycle WHERE project_key=?').get(key);
   if(stored.receipt!==json)throw Object.assign(Error('活动已由其他操作结束，请刷新核对'),{statusCode:409});
  },
  close:()=>db.close(),
 };
}
