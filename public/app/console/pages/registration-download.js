import {requestBlob} from '../../core/api.js';
import {h} from '../../core/dom.js';
import {button} from '../../ui/primitives.js';
import {reportError} from '../../core/toast.js';
export function registrationDownloadButton(event,{canDownload=()=>true,onBusy=()=>{}}={}){
 let busy=false;
 const control=button({label:'下载报名信息表',onClick:async()=>{
  if(busy||!canDownload())return;busy=true;control.disabled=true;onBusy(true);
  try{const {blob}=await requestBlob(`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/registration-export`);const url=URL.createObjectURL(blob),link=h('a',{href:url,download:`${event['活动名称']}-报名信息表.xlsx`});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  catch(error){reportError(error,'报名信息表下载失败');}finally{busy=false;control.disabled=false;onBusy(false);}
 }});return control;
}
