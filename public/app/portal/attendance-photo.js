const MAX_UPLOAD=4*1024*1024,MAX_SOURCE=20*1024*1024,MAX_EDGE=2400;
const invalid=()=>new Error('无法读取这张照片，请在相册中导出为 JPEG，或截图后重新选择上传。');
async function decode(file){
 if(typeof createImageBitmap==='function')try{const image=await createImageBitmap(file,{imageOrientation:'from-image'});return {image,width:image.width,height:image.height,release:()=>image.close()};}catch{/* Older Safari uses the image element fallback. */}
 const url=URL.createObjectURL(file),image=new Image();
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(invalid()),10000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(invalid());};image.src=url;});return {image,width:image.naturalWidth,height:image.naturalHeight,release:()=>{image.src='';URL.revokeObjectURL(url);}};}catch(error){URL.revokeObjectURL(url);throw error;}
}
/** Normalize every decoded image, including small photos, before strict server validation. */
export async function prepareAttendancePhoto(file){
 if(!file||!file.size||file.type&&!['image/jpeg','image/jpg','image/png','image/webp'].includes(file.type))throw invalid();
 if(file.size>MAX_SOURCE)throw new Error('原照片超过20MB，请在相册中压缩或截图后上传。');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const isJpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const isPng=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
 const ascii=(offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
 const isWebp=ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP';
 if(!isJpeg&&!isPng&&!isWebp)throw invalid();
 if(isPng){const view=new DataView(bytes.buffer);for(let offset=8;offset+12<=bytes.length;){const length=view.getUint32(offset);if(ascii(offset+4,4)==='acTL')throw new Error('签到照片需为静态图片，请选择单张照片或截图。');if(length>bytes.length-offset-12)throw invalid();offset+=length+12;}}
 if(isWebp&&ascii(12,4)==='VP8X'&&(bytes[20]&2))throw new Error('签到照片需为静态图片，请选择单张照片或截图。');
 let decoded;
 try{
  decoded=await decode(file);const {width,height,image}=decoded;
  if(!width||!height||width*height>50_000_000||Math.max(width,height)>16000)throw invalid();
  const scale=Math.min(1,MAX_EDGE/Math.max(width,height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const context=canvas.getContext('2d');if(!context)throw invalid();context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const result=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));canvas.width=canvas.height=0;
  if(!result||result.size>MAX_UPLOAD)throw new Error('照片处理后仍超过4MB，请截图或缩小图片后上传。');
  return result;
 }catch(error){throw error instanceof Error?error:invalid();}finally{decoded?.release();}
}
