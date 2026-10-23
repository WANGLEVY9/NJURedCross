import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
const conflict=()=>Object.assign(new Error('活动草稿版本已变化，请重新加载'),{statusCode:409,code:'workspace_version_conflict'});

/** This file must live in PLATFORM_WRITE_STATE_DIR, outside public assets and source control. */
export function openWorkspaceDraftStore(path){
  if(path!==':memory:'&&!isAbsolute(path))throw new Error('草稿存储路径必须为绝对路径');
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS activity_workspace_drafts(
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version>0), data TEXT NOT NULL,
      UNIQUE(owner_id,request_id));`);
  if(path!==':memory:')chmodSync(path,0o600);
  const transaction=task=>{db.exec('BEGIN IMMEDIATE');try{const value=task();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const byId=db.prepare('SELECT data FROM activity_workspace_drafts WHERE id=?');
  const byRequest=db.prepare('SELECT data FROM activity_workspace_drafts WHERE owner_id=? AND request_id=?');
  return {
    read:()=>db.prepare('SELECT data FROM activity_workspace_drafts ORDER BY rowid').all().map(row=>JSON.parse(row.data)),
    readById:id=>byId.all(id).map(row=>JSON.parse(row.data)),
    readByRequest:(ownerId,requestId)=>byRequest.all(ownerId,requestId).map(row=>JSON.parse(row.data)),
    append(row){
      try{db.prepare('INSERT INTO activity_workspace_drafts(id,owner_id,request_id,version,data) VALUES(?,?,?,?,?)').run(row.id,row.ownerId,row.requestId,row.version,JSON.stringify(row));}
      catch(error){if(error.errcode===2067)throw Object.assign(new Error('创建请求已存在'),{statusCode:409,code:'workspace_duplicate_request'});throw error;}
    },
    update:(id,patch,expectedVersion)=>transaction(()=>{
      const stored=db.prepare('SELECT data,version FROM activity_workspace_drafts WHERE id=?').get(id);
      if(!stored||!Number.isSafeInteger(expectedVersion)||stored.version!==expectedVersion)throw conflict();
      const current=JSON.parse(stored.data),next={...current,...patch};
      if(next.id!==current.id||next.ownerId!==current.ownerId||next.requestId!==current.requestId||!Number.isSafeInteger(next.version)||next.version<current.version||next.version>current.version+1)throw conflict();
      const result=db.prepare('UPDATE activity_workspace_drafts SET data=?,version=? WHERE id=? AND version=?').run(JSON.stringify(next),next.version,id,expectedVersion);
      if(result.changes!==1)throw conflict();return next;
    }),
    close:()=>db.close(),
  };
}
