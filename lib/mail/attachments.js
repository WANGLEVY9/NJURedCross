import {createHash} from 'node:crypto';
export function mailAttachments(message){
 if(message.attachments===undefined){if(message.kind==='workflow-hours')throw new Error('最终时长邮件必须包含附件');return [];}
 const items=message.attachments;
 if(message.kind!=='workflow-hours'||!Array.isArray(items)||items.length!==1)throw new Error('邮件附件无效');
 return items.map(item=>{
  if(!item||typeof item.filename!=='string'||!item.filename.endsWith('.xlsx')||item.filename.length>160||/[\r\n\\/]/.test(item.filename)||!Buffer.isBuffer(item.content)||!item.content.length||item.content.length>1024*1024||item.contentType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||Object.keys(item).some(key=>!['filename','content','contentType'].includes(key)))throw new Error('邮件附件无效');
  return {filename:item.filename,content:Buffer.from(item.content),contentType:item.contentType};
 });
}
export const attachmentIntent=items=>items.map(item=>({filename:item.filename,contentType:item.contentType,sha256:createHash('sha256').update(item.content).digest('hex')}));
