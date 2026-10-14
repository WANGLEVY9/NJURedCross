import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {field,button} from '../../ui/primitives.js';
import {rosterReview} from '../../shared/roster-review.js';
import {successMailDefaults,validateSuccessMail,renderSuccessMail} from '../../shared/result-mail.js';

/** Only composes plain text. Saving and delivery remain separate server operations. */
export function successMailEditor(event,refresh,trigger=document.activeElement) {
  const review=rosterReview(event),frozen=Boolean(review?.confirmedAt);
  const editable=event['状态']==='报名中'&&!frozen&&(!review||review.phase==='draft');
  const initial=review?.successMail||null;
  let custom=Boolean(initial),busy=false,committed=false,discarded=false,conflict=false;
  let refreshRequired=Boolean(event.successMailRefreshRequired),failure='',drawer;
  const subject=field({label:'成功邮件主题',value:(initial||successMailDefaults).subject});
  const text=field({label:'成功邮件正文',value:(initial||successMailDefaults).text,multiline:true,rows:12});
  subject.control.setAttribute('aria-label','成功邮件主题');text.control.setAttribute('aria-label','成功邮件正文');
  const subjectCount=h('span',{class:'success-mail-count'}),textCount=h('span',{class:'success-mail-count'});
  subject.querySelector('label').append(subjectCount);text.querySelector('label').append(textCount);
  const get=()=>custom?{subject:subject.control.value,text:text.control.value}:null;
  const dirty=()=>!committed&&!discarded&&JSON.stringify(get())!==JSON.stringify(initial);
  const unsaved=()=>!committed&&!discarded&&(dirty()||subject.control.value!==(initial||successMailDefaults).subject||text.control.value!==(initial||successMailDefaults).text);
  const canEdit=()=>editable&&Boolean(event.rosterToken)&&!committed&&!refreshRequired&&!conflict;
  const state=h('p',{class:'success-mail-state',role:'status','aria-live':'polite'});
  const feedback=h('p',{class:'success-mail-feedback',role:'alert',hidden:true});
  const modeLabel=h('span',{class:'success-mail-mode-label'});
  const errors={subject:'',text:''};
  const previewSubject=h('h3',{class:'success-mail-reader__subject'});
  const previewText=h('div',{class:'success-mail-reader__text'});
  const summaryHeading=h('h3'),summaryText=h('p');
  const summary=h('section',{class:'success-mail-summary'},summaryHeading,summaryText,
    h('dl',{class:'success-mail-facts'},h('dt',{text:'发送时机'}),h('dd',{text:'最终确认名单后，进入原有通知流程。'}),
      h('dt',{text:'通知对象'}),h('dd',{text:'名单中的录取志愿者。'}),h('dt',{text:'内容格式'}),h('dd',{text:'纯文本邮件，保留段落与换行。'})),
    h('p',{class:'success-mail-note',text:'保存草稿不会发送邮件。名单确认后，可在报名名单中查看发送状态；发送状态不代表收件箱已送达。'}));

  const modes=[['default','使用平台默认邮件','无需额外配置，沿用平台结果通知。'],['custom','使用自定义邮件','补充活动群号、集合安排与注意事项。']].map(([value,label,description])=>{
    const input=h('input',{type:'radio',name:'success-mail-mode',value,on:{change:()=>{custom=value==='custom';failure='';update();}}});
    return h('label',{class:'success-mail-mode'},input,h('span',{},h('strong',{text:label}),h('span',{text:description})));
  });
  const modeGroup=h('fieldset',{class:'success-mail-modes'},h('legend',{text:'邮件模板模式'}),...modes);

  // Keep a bounded plain-text history: WebKit can merge insertText with the
  // previous typing transaction. Toolbar edits must be independently undoable.
  let target=text.control,selection=[0,0],composing=false;
  const insertionHistory=new Map();
  for(const control of [subject.control,text.control]) {
    const snapshot=()=>({value:control.value,start:control.selectionStart,end:control.selectionEnd});
    const history={undo:[],redo:[],restoring:false,present:snapshot(),kind:'',at:0};insertionHistory.set(control,history);
    const restoreInsertion=(event,redo)=>{
      if(composing||control.disabled||control.readOnly)return;
      event.preventDefault();
      const from=redo?history.redo:history.undo,to=redo?history.undo:history.redo,entry=from.pop();
      if(!entry)return;
      to.push(snapshot());history.restoring=true;history.kind='';
      control.setRangeText(entry.value,0,control.value.length,'end');control.setSelectionRange(entry.start,entry.end);
      control.dispatchEvent(new Event('input',{bubbles:true}));history.restoring=false;
    };
    control.addEventListener('beforeinput',event=>{
      if(event.inputType==='historyUndo'||event.inputType==='historyRedo')restoreInsertion(event,event.inputType==='historyRedo');
    });
    control.addEventListener('keydown',event=>{
      if(!(event.metaKey||event.ctrlKey)||event.altKey)return;
      if(event.key.toLowerCase()==='z')restoreInsertion(event,event.shiftKey);
      else if(event.key.toLowerCase()==='y')restoreInsertion(event,true);
    });
    const remember=()=>{target=control;selection=[control.selectionStart,control.selectionEnd];if(history.present.value===control.value)history.present=snapshot();};
    for(const type of ['focus','select','keyup','pointerup','blur'])control.addEventListener(type,remember);
    control.addEventListener('compositionstart',()=>{composing=true;});
    control.addEventListener('compositionend',()=>{composing=false;remember();update();});
    control.addEventListener('input',event=>{
      if(!history.restoring&&control.value!==history.present.value){
        const kind=event.inputType||'replacement',now=Date.now();
        const grouped=kind===history.kind&&((kind==='insertText'&&now-history.at<750&&history.present.start===history.present.end)||(kind==='insertCompositionText'&&composing));
        if(!grouped){history.undo.push(history.present);if(history.undo.length>100)history.undo.shift();}
        history.redo=[];history.kind=kind;history.at=now;
      }
      history.present=snapshot();failure='';remember();if(!composing)update();
    });
  }
  let pasteError='';
  subject.control.addEventListener('paste',e=>{
    if(/[\r\n]/.test(e.clipboardData?.getData('text/plain')||'')){e.preventDefault();pasteError='主题只能使用单行文本，请去掉换行后粘贴。';update();}
  });
  subject.control.addEventListener('input',()=>{pasteError='';if(!composing)update();});
  const tokenButtons=['姓名','活动名称','日期','时段','地点'].map(name=>{
    const token='{'+name+'}';
    const node=button({label:token,size:'sm',variant:'ghost',ariaLabel:'插入变量'+token,onClick:()=>{
      if(!canEdit()||busy||composing)return;
      const range=[...selection];
      target.blur();target.focus();target.setSelectionRange(...range);
      const history=insertionHistory.get(target);history.present={value:target.value,start:range[0],end:range[1]};history.kind='';
      target.setRangeText(token,range[0],range[1],'end');
      target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText',data:token}));
      selection=[target.selectionStart,target.selectionEnd];update();
    }});
    node.addEventListener('pointerdown',e=>{e.preventDefault();node.focus({preventScroll:true});});return node;
  });
  const restore=button({label:'恢复建议模板',variant:'ghost',size:'sm',onClick:async()=>{
    if(!canEdit()||busy)return;
    if(!await confirmAction({title:'恢复建议模板？',description:'当前自定义主题和正文将被替换。恢复后仍需保存，不会发送邮件。',confirmLabel:'恢复模板'}))return;
    subject.control.value=successMailDefaults.subject;text.control.value=successMailDefaults.text;
    for(const [control,history] of insertionHistory){history.undo=[];history.redo=[];history.kind='';history.present={value:control.value,start:0,end:0};}
    failure='';pasteError='';update();text.control.focus();
  }});
  const toolbar=h('div',{class:'success-mail-tools',role:'group','aria-label':'插入邮件变量'},h('span',{text:'插入变量'}),...tokenButtons);
  text.insertBefore(toolbar,text.control);
  const editor=h('section',{class:'success-mail-editor','aria-label':'自定义邮件编辑'},
    h('div',{class:'success-mail-section-head'},h('h3',{text:'编辑邮件'}),h('span',{text:'保存后生效'})),subject,text,
    h('div',{class:'success-mail-editor__foot'},h('p',{text:'变量按实际收件人和活动自动替换。'}),restore));
  const reader=h('aside',{class:'success-mail-reader','aria-label':'成功邮件预览'},
    h('div',{class:'success-mail-reader__bar'},h('strong',{text:'邮件预览'}),h('span',{text:'仅预览 · 不会发送'})),
    h('article',{class:'success-mail-paper'},previewSubject,
      h('div',{class:'success-mail-reader__recipient'},h('span',{text:'收件人'}),h('strong',{text:'志愿者（合成示例）'})),previewText));
  const content=h('div',{class:'success-mail-content'},h('div',{class:'success-mail-compose'},modeGroup,summary,editor),reader);
  const retryRefresh=button({label:'重新加载名单',variant:'secondary',onClick:async()=>{
    if(busy)return;busy=true;update();
    try{const ok=await refresh();refreshRequired=ok===false;}catch{refreshRequired=true;}
    busy=false;event.successMailRefreshRequired=refreshRequired;update();
    if(!refreshRequired){discarded=true;await drawer.close();}
  }});
  const close=button({label:'关闭',variant:'ghost',onClick:()=>drawer.close()});
  const save=button({label:'保存邮件草稿',variant:'primary',onClick:async()=>{
    if(!canEdit()||busy||!dirty())return;
    let template;try{template=validateSuccessMail(get());}catch{update();return;}
    busy=true;failure='';update();
    try {
      await request(`/api/volunteer/workflow/events/${event._id}/success-mail`,{method:'PATCH',body:{template,token:event.rosterToken}});
    } catch(error) {
      busy=false;conflict=error.status===409;
      failure=conflict?'名单或模板已变化，不能覆盖。草稿仍保留，请复制所需内容并关闭后刷新核对。':`保存未完成，草稿仍保留。${error.message||'请稍后重试。'}`;
      update();return;
    }
    // The write has been acknowledged. A subsequent read must never relabel it
    // as a failed save, nor enable a replay using the now-stale roster token.
    committed=true;update();
    notify.success(custom?'自定义邮件草稿已保存，尚未发送':'已恢复平台默认邮件，尚未发送');
    try{refreshRequired=(await refresh())===false;}catch{refreshRequired=true;}
    event.successMailRefreshRequired=refreshRequired;busy=false;update();
  }});
  function validateField(control,kind) {
    const value=control.value;
    if(kind==='subject'&&pasteError)return pasteError;
    try{validateSuccessMail(kind==='subject'?{subject:value,text:'正文'}:{subject:'主题',text:value});return '';}
    catch(error){return error.message;}
  }
  function update() {
    const editing=custom&&editable&&!committed&&!refreshRequired,subjectError=editing?validateField(subject.control,'subject'):'',textError=editing?validateField(text.control,'text'):'';
    if(errors.subject!==subjectError){subject.setError(subjectError);errors.subject=subjectError;}
    if(errors.text!==textError){text.setError(textError);errors.text=textError;}
    subjectCount.textContent=`${subject.control.value.length} / 120`;textCount.textContent=`${text.control.value.length} / 5000`;
    editor.hidden=!editing;summary.hidden=editing;
    modeGroup.hidden=!canEdit();
    for(const mode of modes){const input=mode.querySelector('input');input.checked=(input.value==='custom')===custom;input.disabled=busy;}
    for(const control of [subject.control,text.control]){control.disabled=busy;control.readOnly=!canEdit();}
    for(const control of [restore,...tokenButtons])control.disabled=busy||!canEdit();
    reader.hidden=refreshRequired&&!committed;
    const value=renderSuccessMail(get(),event,{'姓名':'志愿者'});
    previewSubject.textContent=value.subject;previewText.textContent=value.text;
    modeLabel.textContent=frozen?'模板已冻结':custom?'自定义邮件':'平台默认邮件';
    summaryHeading.textContent=frozen?'名单已最终确认':committed?'邮件草稿已保存':refreshRequired?'请先核对最新名单':!editable?'当前仅可查看':'默认邮件，无需额外配置';
    summaryText.textContent=frozen?'邮件内容已冻结，重新调整名单也不会解锁模板。':committed?'本次仅保存模板，没有发送邮件。关闭后可返回名单继续操作。':refreshRequired?'上次操作后的名单未刷新完成，请重新加载后再编辑。':!editable?'活动或名单当前状态不允许修改模板。':'平台会生成报名结果通知。需要添加活动群号或参与安排时，可选择自定义邮件。';
    const status=busy?(committed?'邮件已保存，正在刷新名单…':'正在保存邮件草稿…'):committed?'✓ 邮件草稿已保存 · 尚未发送':frozen?'模板已冻结 · 请在名单中查看发送状态':conflict?'名单版本冲突 · 草稿已保留':failure?'保存失败 · 草稿已保留':dirty()?'有未保存修改 · 保存后生效':unsaved()?'自定义草稿未保存 · 当前仍为平台默认邮件':initial?'自定义模板已保存 · 尚未发送':'当前使用平台默认邮件';
    if(state.textContent!==status)state.textContent=status;
    feedback.textContent=failure||(refreshRequired?(committed?'邮件已保存，但名单刷新失败。无需重复保存，请重新加载名单。':'名单尚未刷新，请先重新加载。'):'');
    feedback.hidden=!feedback.textContent;
    save.hidden=!editable||committed||refreshRequired;save.disabled=!canEdit()||busy||!dirty()||Boolean(subjectError||textError);
    save.dataset.loading=String(busy&&!committed);save.setAttribute('aria-busy',String(busy&&!committed));
    close.disabled=busy;retryRefresh.hidden=!refreshRequired;retryRefresh.disabled=busy;
    if(drawer){drawer.surface.dataset.mode=editing?'custom':'reader';drawer.surface.dataset.state=committed?'saved':frozen?'frozen':conflict?'conflict':failure?'error':unsaved()?'dirty':'clean';}
  }
  drawer=openDrawer({title:'报名成功邮件',eyebrow:'事务通知',description:event['活动名称'],width:1160,workspace:true,
    body:h('div',{class:'success-mail-workspace'},h('div',{class:'success-mail-context'},modeLabel,h('span',{text:frozen?'名单已确认 · 发送状态见报名名单':'最终确认名单后进入发送流程'})),content),
    footer:[feedback,state,retryRefresh,close,save],beforeClose:async()=>!busy&&(!unsaved()||await confirmAction({title:'放弃未保存的邮件修改？',description:'已保存的邮件模板不受影响。',confirmLabel:'放弃修改'})),
    onClose:()=>{
      const restore=trigger?.isConnected&&trigger.matches?.('button')?trigger:Array.from(document.querySelectorAll('.activity-roster button')).find(node=>/^(编辑成功邮件（可选）|查看成功邮件)$/.test(node.textContent));
      restore?.focus({preventScroll:true});
    }});
  drawer.surface.classList.add('notification-email','success-mail-drawer');
  drawer.surface.isSaving=()=>busy;drawer.surface.hasUnsaved=()=>unsaved()||busy;drawer.surface.discard=()=>{discarded=true;};update();
}
