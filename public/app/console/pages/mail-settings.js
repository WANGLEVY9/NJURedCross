import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,field,panel,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';

export async function openMailSettings(){
 const data=await request('/api/console/mail-settings');let settings=data.settings,active=data.types[0][0],dirty=false,busy=false,modal;
 const recovery=h('div',{class:'stack-3',role:'status'});
 const body=h('div',{class:'stack-4'}),editor=h('div',{class:'stack-3'}),preview=h('pre',{class:'mail-template-preview'});
 const sample={'报名信息':'献血车志愿服务\n服务岗位：新街口中央志愿服务岗\n服务时间：2030-10-23 11:00–15:00\n服务地点：新街口中央','入群信息':'QQ群号：示例群号\n入群链接：示例链接','姓名':'示例志愿者','活动类别':'献血车专项','活动名称':'献血车志愿服务','日期':'2030-10-23','时段':'11:00-15:00','地点':'新街口中央','岗位':'志愿服务岗','报名网址':'https://njuredcross.cn/workflow-events','原主题':'示例邮件主题','原正文':'此处会保留系统生成的完整业务内容、验证码或处理结果。'};
 const refresh=()=>{const vars={...sample,'入群信息':['QQ群号：'+(settings.defaults.qqGroup||'123456789（示例）'),'入群链接：'+(settings.defaults.invitation||'https://example.invalid/join（示例）')].filter(Boolean).join('\n'),'QQ群号':settings.defaults.qqGroup,'邀请链接':settings.defaults.invitation,'注意事项':settings.defaults.notes||'注意事项（示例）：请提前10分钟到达服务地点，按活动要求完成培训和签到。','反馈表链接':settings.defaults.feedbackUrl};const render=text=>text.replace(/\{([^{}]+)\}/g,(_,key)=>vars[key]||'');preview.textContent=render(settings.templates[active].subject)+'\n\n'+render(settings.templates[active].text);};
 function draw(){editor.replaceChildren();const template=settings.templates[active];
  let target=null;const chips=h('div',{class:'row-2 row-wrap'});
  for(const name of ['报名信息','入群信息','注意事项','报名网址','原主题','原正文'].filter(name=>data.variables.includes(name))){const token='{'+name+'}',chip=button({label:name,size:'sm',onClick:()=>{if(!target){notify.warning('请先点击邮件主题或正文中的插入位置');return;}target.focus();target.setRangeText(token,target.selectionStart,target.selectionEnd,'end');target.dispatchEvent(new Event('input',{bubbles:true}));}});chip.draggable=true;chip.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',token));chips.append(chip);}editor.append(h('p',{class:'t-caption',text:'先点击正文确定位置，再点击变量插入；电脑也可拖入。姓名固定用于称呼。QQ群号与链接请在活动的“通知信息编辑”填写。'}),chips);
  for(const [key,label,multiline]of [['subject','邮件主题',false],['text','邮件正文',true]]){const item=field({label,value:template[key],multiline,onInput:e=>{template[key]=e.target.value;dirty=true;refresh();}});item.control.addEventListener('focus',()=>{target=item.control;});editor.append(item);}refresh();
 }
 const type=field({label:'邮件类型',options:data.types.map(([value,label])=>({value,label})),value:active,onInput:e=>{active=e.target.value;draw();}});
 const restore=button({label:'恢复当前类型默认模板',onClick:async()=>{if(!await confirmAction({title:'恢复默认模板？',description:'只替换当前邮件类型，保存后生效。',confirmLabel:'恢复'}))return;settings.templates[active]=structuredClone(data.defaults.templates[active]);dirty=true;draw();}});
 body.append(recovery);
 body.append(notice('模板只影响新生成的邮件，已进入发送队列的正文会保留。安全邮件必须保留“{原正文}”。',{tone:'neutral'}),panel({title:'邮件模板',body:h('div',{class:'stack-3'},type,h('p',{class:'t-caption',text:'姓名和活动变量用于报名成功及参与提醒；其他类型可用 {原主题}、{原正文} 保留系统数据。可用变量：'+data.variables.map(v=>'{'+v+'}').join('、')}),editor,restore,h('h3',{text:'示例预览（不会发送）'}),h('p',{class:'t-caption',text:'未填写的入群信息和注意事项在此用示例展示；真实发送使用活动“通知信息编辑”的内容，不会发送示例。'}),preview)}));
 const common=h('div',{class:'stack-3'});
 for(const [key,label,type]of [['qqGroup','QQ群号','text'],['invitation','邀请链接','url'],['notes','注意事项','textarea'],['feedbackUrl','请假反馈表链接','url'],['reminderTime','前一天提醒时间（北京时间）','time']])common.append(field({label,type:type==='textarea'?'text':type,multiline:type==='textarea',value:settings.defaults[key],onInput:e=>{settings.defaults[key]=e.target.value;dirty=true;refresh();}}));
 body.append(panel({title:'邮件公共信息与自动提醒',body:common}));
 const guides=h('div',{class:'stack-4'});
 for(const [key,label]of [['overview','报名前须知'],['training','前期培训'],['location','服务点位'],['hours','时长查询'],['checkin','签到示例']]){
  const section=h('div',{class:'stack-2'},field({label,value:settings.guide[key],multiline:true,onInput:e=>{settings.guide[key]=e.target.value;dirty=true;}}));
  if(key!=='overview')section.append(field({label:label+'配图网址（每行一个）',value:settings.guide[key+'Image'],multiline:true,onInput:e=>{settings.guide[key+'Image']=e.target.value;dirty=true;}}));guides.append(section);
 }
 body.append(panel({title:'献血车参与说明',body:guides}));draw();
 const save=button({label:'保存模板与说明',variant:'primary',onClick:async()=>{if(busy)return;busy=true;save.disabled=true;for(const node of body.querySelectorAll('input,textarea,button,select'))node.disabled=true;try{const result=await request('/api/console/mail-settings',{method:'PUT',body:settings});settings=result.settings;dirty=false;busy=false;notify.success('已保存邮件模板和参与说明');await modal.close();}catch(error){if(error.status===409||error.statusCode===409){recovery.replaceChildren(notice('其他管理员已修改配置。你的编辑仍保留，尚未覆盖对方内容。请复制需要保留的文字后重新打开设置核对。',{tone:'warning'}));recovery.scrollIntoView({block:'nearest'});}reportError(error,'保存未完成，编辑内容已保留');}finally{busy=false;save.disabled=false;for(const node of body.querySelectorAll('input,textarea,button,select'))node.disabled=false;}}});
 modal=openModal({title:'邮件模板与参与说明',width:960,body,footer:[button({label:'取消',onClick:()=>modal.close()}),save]});
 modal.setCloseGuard(async()=>!busy&&(!dirty||await confirmAction({title:'放弃未保存的修改？',confirmLabel:'放弃修改'})));
}
