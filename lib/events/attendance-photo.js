/** Private evidence files. Never served from the public static directory. */
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import { collectRequestBody } from '../http/request-body.js';
import { assertRequestActive } from '../http/request-budget.js';
import { validateAttendancePhoto } from './photo-validation.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const directory=()=>process.env.WORKFLOW_EVIDENCE_DIR||(process.env.NODE_ENV==='production'?'/var/lib/njuredcross-evidence':join(process.cwd(),'.workflow-evidence'));
export function photoType(bytes){
 if(bytes.length<16)throw fail(400,'图片文件无效');
 if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 throw fail(400,'仅支持 JPEG、PNG 或 WebP 图片');
}
export async function storePhoto(req) {
  const bytes = await collectRequestBody(req, 4 * 1024 * 1024);
  assertRequestActive();
  await validateAttendancePhoto(bytes);
  assertRequestActive();

  const id = randomUUID();
  const targetDirectory = directory();
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  assertRequestActive();

  await writeFile(join(targetDirectory, id), bytes, {
    mode: 0o600,
    flag: 'wx',
  });
  return id;
}
export async function removePhoto(id){await unlink(join(directory(),id)).catch(()=>{});}
export async function sendPhoto(res,id){
 if(!/^[a-f0-9-]{36}$/.test(id||''))throw fail(404,'尚未提交签到照片');
 let bytes;try{bytes=await readFile(join(directory(),id));}catch{throw fail(404,'签到照片不存在，请联系负责人');}
 res.writeHead(200,{'Content-Type':photoType(bytes),'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
}
