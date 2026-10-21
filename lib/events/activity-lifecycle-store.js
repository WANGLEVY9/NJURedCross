import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

/** Durable management decisions independent of regenerated source rows. */
export function createActivityLifecycleStore(file=':memory:'){
 if(file!==':memory:'){if(!isAbsolute(file))throw Error('活动状态存储需要绝对路径');mkdirSync(dirname(file),{recursive:true});}
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS activity_lifecycle (project_key TEXT PRIMARY KEY, receipt TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS source_registration (project_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, decision TEXT NOT NULL)');
 const registration=key=>{const row=db.prepare('SELECT decision FROM source_registration WHERE project_key=?').get(key);return row?JSON.parse(row.decision):{enabled:true,revision:0};};
 return {
  registration,
  setRegistration(key,{enabled,revision,actor,at}){
   db.exec('BEGIN IMMEDIATE');
   try{
    const current=registration(key);
    // Retry a committed desired state safely; never let a stale opposite decision win.
    if(current.enabled===enabled){db.exec('COMMIT');return current;}
    if(current.revision!==revision)throw Object.assign(Error('报名开关已变化，请刷新后重试'),{statusCode:409});
    const decision={enabled,revision:revision+1,actor,at};
    db.prepare('INSERT INTO source_registration(project_key,revision,decision) VALUES(?,?,?) ON CONFLICT(project_key) DO UPDATE SET revision=excluded.revision,decision=excluded.decision').run(key,decision.revision,JSON.stringify(decision));
    db.exec('COMMIT');return decision;
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
