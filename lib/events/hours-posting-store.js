import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

/** Durable receipts are separate from the original NJUTable schema/settings. */
export function createHoursPostingStore(file=':memory:'){
 if(file!==':memory:'){if(!isAbsolute(file))throw Error('时长同步状态需要绝对路径');mkdirSync(dirname(file),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS hours_posting_state (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS hours_posting_lease (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL)');
 if(file!==':memory:')chmodSync(file,0o600);
 return {
  acquire(owner,now,ttl=60000){return db.prepare("INSERT INTO hours_posting_lease(id,owner,expires) VALUES('posting',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE hours_posting_lease.owner=excluded.owner OR hours_posting_lease.expires<=?").run(owner,now+ttl,now).changes===1;},
  release(owner){db.prepare("DELETE FROM hours_posting_lease WHERE id='posting' AND owner=?").run(owner);},
  get(kind,id){const row=db.prepare('SELECT value FROM hours_posting_state WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.value):null;},
  set(kind,id,value){const json=JSON.stringify(value);db.prepare('INSERT INTO hours_posting_state(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,id,json);return value;},
  all(kind){return db.prepare('SELECT value FROM hours_posting_state WHERE kind=? ORDER BY id').all(kind).map(row=>JSON.parse(row.value));},
  close:()=>db.close(),
 };
}
