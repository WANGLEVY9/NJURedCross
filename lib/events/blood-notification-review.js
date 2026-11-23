import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {bloodSourceEventId,sourceText} from './blood-source.js';
import {observer} from '../observability.js';

const reviewError=message=>Object.assign(new Error(message),{statusCode:409,code:'blood_notification_review_changed'});
const resultLabels=new Set(['可报名','待审核','待确认','审核中','成功','失败','未入选','已取消','请假','停点','已停点']);

// The platform verifies its own source write before it marks the website row synced.
// The website state and the bound source row therefore supply the expected snapshot.
function expectedResult(row){
  if(row['岗位同步状态']!=='已同步')return null;
  if(row['报名状态']==='待筛选')return '待审核';
  if(['已确认','已签到'].includes(row['报名状态'])&&[true,'true'].includes(row['是否报名成功']))return '成功';
  return null;
}

export function createBloodNotificationReview({path,readSourceRow}){
  const db=new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS blood_notification_review (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision TEXT NOT NULL,
    detected_at TEXT NOT NULL, released INTEGER NOT NULL DEFAULT 0
  ); CREATE TABLE IF NOT EXISTS blood_notification_platform_confirmation (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL
  )`);
  const find=db.prepare('SELECT * FROM blood_notification_review WHERE id=?');
  const save=db.prepare(`INSERT INTO blood_notification_review(id,fingerprint,revision,detected_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint,revision=excluded.revision,released=0`);
  const release=db.prepare('UPDATE blood_notification_review SET released=1 WHERE id=? AND revision=? AND released=0');
  const pendingConfirmation=db.prepare('SELECT source_id FROM blood_notification_platform_confirmation WHERE id=?');
  const recordConfirmation=db.prepare('INSERT OR REPLACE INTO blood_notification_platform_confirmation VALUES (?,?)');
  const finishConfirmation=db.prepare('DELETE FROM blood_notification_platform_confirmation WHERE id=?');

  function inspect(row,source){
    const expected=expectedResult(row);
    if(!expected)return null;
    const id=row._id,sourceId=row['岗位源行ID'];
    const result=sourceText(source?.['报名结果']);
    const linked=Boolean(source&&sourceId&&row['报名ID']&&row['账号ID']&&row['学号']&&source._id===sourceId&&
      sourceText(source['网站报名ID'])===row['报名ID']&&sourceText(source['网站账号ID'])===row['账号ID']&&
      sourceText(source['学号'])===row['学号']&&
      bloodSourceEventId(String(source['日期']||'').slice(0,10),source['点位'],source['活动时间'])===row['活动ID']);
    let record=find.get(id);
    // The source write can succeed before the website write. A verified local receipt
    // makes that exact retry distinguishable from a source-only manual edit.
    if(linked&&expected==='待审核'&&result==='成功'&&(!record||record.released)&&pendingConfirmation.get(id)?.source_id===sourceId)return null;
    const matches=linked&&result===expected;
    const fingerprint=createHash('sha256').update(JSON.stringify([sourceId,expected,result,linked])).digest('hex');
    if((!matches||record&&!record.released)&&record?.fingerprint!==fingerprint){
      save.run(id,fingerprint,randomUUID(),new Date().toISOString());
      record=find.get(id);
    }
    if(!record||record.released)return null;
    return {id,revision:record.revision,detectedAt:record.detected_at,registrationCode:row['报名ID'],
      date:row['报名日期'],slot:row['报名时段'],expected,
      actual:!linked?'岗位关联异常':resultLabels.has(result)?result:result?'其他状态':'空白',canRelease:matches};
  }

  const freshSource=row=>row['岗位源行ID']
    ?observer.dependency('seatable','blood-mail-source-read',()=>readSourceRow(row['岗位源行ID'])):null;
  return {
    close:()=>db.close(),
    inspect,
    recordConfirmation:(id,sourceId)=>recordConfirmation.run(id,sourceId),
    finishConfirmation:id=>finishConfirmation.run(id),
    async permits(row){
      return expectedResult(row)==='成功'&&!inspect(row,await freshSource(row));
    },
    list(registrations,sources){
      const byId=new Map(sources.map(row=>[row._id,row]));
      return registrations.map(row=>inspect(row,byId.get(row['岗位源行ID']))).filter(Boolean)
        .sort((a,b)=>b.detectedAt.localeCompare(a.detectedAt));
    },
    async release(row,id,revision){
      if(!row||!revision||find.get(id)?.revision!==revision)throw reviewError('待核对记录已改变，请刷新后重试');
      const current=inspect(row,await freshSource(row));
      if(!current||current.revision!==revision)throw reviewError('待核对记录已改变，请刷新后重试');
      if(!current.canRelease)throw reviewError('请先核对底表岗位及报名结果，使其与平台记录一致');
      if(!release.run(id,revision).changes)throw reviewError('待核对记录已处理，请刷新后重试');
    },
  };
}
