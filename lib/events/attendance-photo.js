/**
 * 签到凭证的读写出口。
 *
 * 业务表「签到照片ID」始终是裸 UUID；真实字节可以放在 NJU Box（默认，按
 * 年月 / 活动 / 报名分层）或本地私有目录（未配置 Box / Box 故障时的回退）。
 * Box 文件的路径与归属记在 SQLite 元数据表，读取时按 id 反查。历史上没有
 * 元数据行的本地文件仍可直接读取，保证迁移期间零中断。
 */
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import { collectRequestBody } from '../http/request-body.js';
import { assertRequestActive } from '../http/request-budget.js';
import { validateAttendancePhoto } from './photo-validation.js';
import { openEvidenceStore } from './attendance-evidence-store.js';
import { boxStatus, uploadBuffer, downloadBuffer, deleteFile, NJUBOX_LIBRARIES } from '../attachment/box.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const UUID=/^[a-f0-9-]{36}$/;
const DEFAULT_MAX_BYTES=8*1024*1024;
const directory=()=>process.env.WORKFLOW_EVIDENCE_DIR||(process.env.NODE_ENV==='production'?'/var/lib/njuredcross-evidence':join(process.cwd(),'.workflow-evidence'));

let boxConfigOverride=null;
let storePromise=null;

/** 测试与运维注入：自定义 Box 客户端配置（含 njuboxFetch mock）。 */
export function setEvidenceBoxConfig(config){boxConfigOverride=config;}
export function resetEvidenceStore(){storePromise=null;boxConfigOverride=null;}
/** 关闭模块级 SQLite 连接（测试清理 / 进程退出前），Windows 下未关闭会导致临时目录无法删除。 */
export async function closeEvidenceStore(){
  const store=await storePromise?.catch(()=>null);
  store?.close();
  storePromise=null;
}
export const attendanceRoot=()=>process.env.NJUBOX_ATTENDANCE_DIR?.trim()||'/签到凭证';

export function maxEvidenceBytes(){
  const value=Number(process.env.WORKFLOW_EVIDENCE_MAX_BYTES||DEFAULT_MAX_BYTES);
  return Number.isSafeInteger(value)&&value>=1024*1024&&value<=20*1024*1024?value:DEFAULT_MAX_BYTES;
}

export function evidenceBoxConfig(){
  return boxConfigOverride||{
    njuboxServerUrl:process.env.NJUBOX_SERVER_URL?.trim()||'https://box.nju.edu.cn',
    njuboxToken:process.env.NJUBOX_MAIN_TOKEN?.trim()||process.env.NJUBOX_API_TOKEN?.trim()||'',
  };
}

export function evidenceProvider(){
  const setting=String(process.env.WORKFLOW_EVIDENCE_PROVIDER||'auto').trim();
  if(setting==='local')return 'local';
  if(setting==='box')return 'box';
  return boxStatus(evidenceBoxConfig()).configured?'box':'local';
}

/** 文件名/目录名清洗：保留中文、字母数字、空格与连字符，移除路径分隔符与非法字符。 */
const safe=value=>String(value??'').normalize('NFKC')
  .replace(/[\\/:*?"<>|\r\n\t]/g,'_').replace(/\s+/g,' ').trim().slice(0,48)||'未标注';

/** 北京时间「YYYYMMDD-HHmmss」，作为业务要求的时间后缀。 */
export function attendanceStamp(value){
  const input=value?new Date(value):new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
    .formatToParts(Number.isFinite(input.getTime())?input:new Date());
  const get=type=>parts.find(part=>part.type===type)?.value||'00';
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

/**
 * 业务口径：主库「签到凭证」文件夹，按 <年月>/<活动名> 分层，
 * 文件名 = <姓名>_<活动名>_<短ID>_<签到时间>.<ext>——姓名、活动名一眼可读，时间作后缀。
 * 短 ID 防止同名同学同一秒签同一活动时相互覆盖。
 */
export function attendanceBoxPath(context={},id,mime){
  const signedAt=context.signedAt||new Date().toISOString();
  const stamp=attendanceStamp(signedAt);
  const month=`${stamp.slice(0,4)}-${stamp.slice(4,6)}`;
  const eventName=safe(context.eventName||context.eventId||'未关联活动');
  const personName=safe(context.name||'未关联人员');
  const shortId=String(id||'').replace(/-/g,'').slice(0,8)||'00000000';
  const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  return {
    relativePath:`${month}/${eventName}`,
    filename:`${personName}_${eventName}_${shortId}_${stamp}.${ext}`,
    signedAt,personName,eventName,
  };
}

async function getStore(){if(!storePromise)storePromise=openEvidenceStore();return storePromise;}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function assertQuota(store,context){
  const limit=Number(process.env.WORKFLOW_EVIDENCE_MAX_PER_ACCOUNT||30);
  if(!Number.isSafeInteger(limit)||limit<1)return;
  const studentId=String(context.studentId||'').trim();
  if(!studentId)return;
  const used=store.list().filter(row=>row.student_id===studentId).length;
  if(used>=limit)throw fail(429,'本账号的签到凭证数量已达上限');
}

export function photoType(bytes){
 if(bytes.length<16)throw fail(400,'图片文件无效');
 if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 throw fail(400,'仅支持 JPEG、PNG 或 WebP 图片');
}

async function writeLocal(id,bytes){
  const targetDirectory=directory();
  await mkdir(targetDirectory,{recursive:true,mode:0o700});
  assertRequestActive();
  await writeFile(join(targetDirectory,id),bytes,{mode:0o600,flag:'wx'});
  return id;
}

export async function storePhoto(req,context={}) {
  const maxBytes=maxEvidenceBytes();
  const bytes = await collectRequestBody(req, maxBytes);
  assertRequestActive();
  await validateAttendancePhoto(bytes,{maxBytes});
  assertRequestActive();

  const id=randomUUID(),mime=photoType(bytes);
  if(evidenceProvider()==='box'){
    let store=null;
    try{
      store=await getStore();
      assertQuota(store,context);
      const plan=attendanceBoxPath(context,id,mime);
      const uploaded=await uploadBuffer(evidenceBoxConfig(),{dir:attendanceRoot(),relativePath:plan.relativePath,filename:plan.filename,buffer:bytes,contentType:mime});
      store.record({
        id,provider:'box',path:uploaded.path,bytes:bytes.length,mime,sha256:digest(bytes),
        event_id:String(context.eventId||''),event_name:plan.eventName,person_name:plan.personName,
        registration_code:String(context.registrationCode||''),student_id:String(context.studentId||''),
        filename:plan.filename,signed_at:plan.signedAt,created_at:new Date().toISOString(),
      });
      return id;
    }catch(error){
      if(error?.statusCode===429)throw error;
      // Box 不可用不能阻断现场签到：自动回退本地私有目录，并由回收脚本后续迁移。
    }
  }
  return writeLocal(id,bytes);
}

export async function removePhoto(id){
 if(!UUID.test(String(id||'')))return;
 const store=await getStore().catch(()=>null);
 const entry=store?.get(id);
 if(entry?.provider==='box')await deleteFile(evidenceBoxConfig(),entry.path,NJUBOX_LIBRARIES.main).catch(()=>{});
 else await unlink(join(directory(),id)).catch(()=>{});
 store?.remove(id);
}

export async function sendPhoto(res,id){
 if(!UUID.test(id||''))throw fail(404,'尚未提交签到照片');
 const store=await getStore().catch(()=>null);
 const entry=store?.get(id);
 let bytes;
 try{
   bytes=entry?.provider==='box'
     ?await downloadBuffer(evidenceBoxConfig(),entry.path,NJUBOX_LIBRARIES.main,{maxBytes:maxEvidenceBytes()})
     :await readFile(join(directory(),id));
 }catch{throw fail(404,'签到照片不存在，请联系负责人');}
 res.writeHead(200,{'Content-Type':photoType(bytes),'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
}
