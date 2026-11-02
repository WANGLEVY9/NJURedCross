import {request} from '../../core/api.js';
import {h} from '../../core/dom.js';
import {field,button} from '../../ui/primitives.js';
import {openDrawer} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';

export async function editAdminActivityInformation(event,onSaved=async()=>{}){
 const url=`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/admin-information`;
 let data;try{data=await request(url,{fresh:true});}catch(error){reportError(error,'活动信息加载失败');return;}const controls={};
 for(const [key,label] of [['name','活动名称'],['description','活动介绍'],['notice','报名通知'],['qqGroup','联系 QQ 群'],['invitation','入群邀请'],['notes','注意事项']])controls[key]=field({label,value:data.values[key]||'',required:key==='name',multiline:key!=='name'&&key!=='qqGroup',maxlength:key==='name'?200:10000});
 let drawer,busy=false;
 const save=button({label:'保存修改',variant:'primary',onClick:async()=>{
  if(busy||!controls.name.control.reportValidity())return;busy=true;save.disabled=true;
  try{await request(url,{method:'PATCH',body:{token:data.token,values:Object.fromEntries(Object.entries(controls).map(([key,f])=>[key,f.control.value]))}});busy=false;await drawer.close();await onSaved();notify.success('活动信息已保存');}
  catch(error){reportError(error,'活动信息未保存');}finally{busy=false;save.disabled=false;}
 }});
 drawer=openDrawer({title:'活动信息修改',width:820,body:h('div',{class:'stack-4'},...Object.values(controls)),footer:[save]});drawer.setCloseGuard(()=>!busy);
 return {isSaving:()=>busy,hasUnsaved:()=>busy};
}
