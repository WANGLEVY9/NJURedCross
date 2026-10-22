import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {request} from '../../core/api.js';
import {openModal} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
export async function editRegistrationContact(eventId){
 const path=`/api/volunteer/workflow/events/${encodeURIComponent(eventId)}/registration-contact`,{result}=await request(path,{fresh:true});
 const qq=field({label:'QQ群号',value:result.contact.qqGroup,maxlength:30,inputmode:'numeric',hint:'填写本活动的QQ群号，将用于后续新生成的报名成功邮件和参与提醒。'}),invitation=field({label:'邀请链接',type:'url',value:result.contact.invitation,maxlength:500}),notes=field({label:'注意事项',multiline:true,rows:4,value:result.contact.notes,maxlength:500});
 let dialog,saving=false;
 const save=button({label:'保存通知信息',variant:'primary',disabled:!result.canEdit,onClick:async()=>{if(saving||![qq,invitation,notes].every(f=>f.control.reportValidity()))return;saving=true;save.disabled=true;for(const f of [qq,invitation,notes])f.control.disabled=true;try{await request(path,{method:'PATCH',body:{token:result.token,qqGroup:qq.control.value,invitation:invitation.control.value,notes:notes.control.value}});saving=false;await dialog.close();notify.success('通知信息编辑已保存');}catch(error){reportError(error,'保存未完成，请关闭后重新打开核对');}finally{saving=false;save.disabled=!result.canEdit;for(const f of [qq,invitation,notes])f.control.disabled=!result.canEdit;}}});
 for(const f of [qq,invitation,notes])f.control.disabled=!result.canEdit;
 dialog=openModal({title:'通知信息编辑',width:640,body:h('div',{class:'stack-4'},!result.canEdit?notice('当前阶段或账号不能修改通知信息编辑。',{tone:'neutral'}):null,qq,invitation,notes),footer:[button({label:'取消',onClick:()=>dialog.close()}),save]});dialog.setCloseGuard(()=>!saving);
}
