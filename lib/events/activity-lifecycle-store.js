import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

/** Durable management decisions independent of regenerated source rows. */
export function createActivityLifecycleStore(file=':memory:'){
 if(file!==':memory:'){if(!isAbsolute(file))throw Error('活动状态存储需要绝对路径');mkdirSync(dirname(file),{recursive:true});}
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS activity_lifecycle (project_key TEXT PRIMARY KEY, receipt TEXT NOT NULL)');
 return {
  get(key){const row=db.prepare('SELECT receipt FROM activity_lifecycle WHERE project_key=?').get(key);return row?JSON.parse(row.receipt):null;},
  save(key,receipt){
   const json=JSON.stringify(receipt);db.prepare('INSERT OR IGNORE INTO activity_lifecycle(project_key,receipt) VALUES(?,?)').run(key,json);
   const stored=db.prepare('SELECT receipt FROM activity_lifecycle WHERE project_key=?').get(key);
   if(stored.receipt!==json)throw Object.assign(Error('活动已由其他操作结束，请刷新核对'),{statusCode:409});
  },
  close:()=>db.close(),
 };
}
