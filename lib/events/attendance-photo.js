/** Private evidence files. Never served from the public static directory. */
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const directory=()=>process.env.WORKFLOW_EVIDENCE_DIR||(process.env.NODE_ENV==='production'?'/var/lib/njuredcross-evidence':join(process.cwd(),'.workflow-evidence'));
export function photoType(bytes){
 if(bytes.length<16)throw fail(400,'图片文件无效');
 if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 throw fail(400,'仅支持 JPEG、PNG 或 WebP 图片');
}
export async function storePhoto(req){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>4*1024*1024)throw fail(413,'签到照片不能超过4MB');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);photoType(bytes);const id=randomUUID();await mkdir(directory(),{recursive:true,mode:0o700});await writeFile(join(directory(),id),bytes,{mode:0o600,flag:'wx'});return id;
}
export async function removePhoto(id){await unlink(join(directory(),id)).catch(()=>{});}
export async function sendPhoto(res,id){
 if(!/^[a-f0-9-]{36}$/.test(id||''))throw fail(404,'尚未提交签到照片');
 let bytes;try{bytes=await readFile(join(directory(),id));}catch{throw fail(404,'签到照片不存在，请联系负责人');}
 res.writeHead(200,{'Content-Type':photoType(bytes),'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
}
