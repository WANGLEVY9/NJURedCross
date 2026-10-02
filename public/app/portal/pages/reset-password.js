import { h, icon } from '../../core/dom.js';
import { getRegistrationConfig, resendEmailCode, resetPassword } from '../../core/api.js';
import { navigate } from '../../core/router.js';
import { button, field, notice } from '../../ui/primitives.js';
import { notify } from '../../core/toast.js';
import { PASSWORD_HINT, passwordPolicyError } from '../../core/password-policy.js';

export default async function resetPasswordPage() {
  const config = await getRegistrationConfig().catch(()=>({enabled:false,minimumPasswordLength:8}));
  const min = config.minimumPasswordLength || 8;
  const email = field({label:'校园邮箱',name:'email',type:'email',required:true,autocomplete:'email',placeholder:'you@smail.nju.edu.cn'});
  const code = field({label:'6 位重置验证码',name:'code',required:true,maxlength:6,autocomplete:'one-time-code'});
  code.control.inputMode='numeric';
  const password = field({label:'设置新密码',name:'password',type:'password',required:true,autocomplete:'new-password',maxlength:72,placeholder:`至少 ${min} 位`});
  const confirm = field({label:'再次输入新密码',name:'confirm',type:'password',required:true,autocomplete:'new-password',maxlength:72});
  const errors=h('div',{hidden:true,role:'alert'});
  const feedback=h('div',{'aria-live':'polite'});
  let timer=null, sending=false, resetting=false;
  const send=button({label:'获取重置验证码',variant:'ghost',iconName:'mail',onClick:()=>sendCode()});
  const submit=button({label:'重置密码',variant:'primary',block:true,onClick:()=>reset()});
  send.disabled=!config.enabled; submit.disabled=!config.enabled;
  function cooldown(seconds) {
    let remaining=seconds;clearInterval(timer);send.disabled=true;send.textContent=`${remaining} 秒后可重发`;
    timer=setInterval(()=>{remaining-=1;if(remaining<=0){clearInterval(timer);send.disabled=false;send.textContent='重新发送验证码';}else send.textContent=`${remaining} 秒后可重发`;},1000);
  }
  async function sendCode() {
    if(sending || send.disabled) return;
    email.setError(null);
    if(!email.control.value.trim()){email.setError('请填写校园邮箱');email.control.focus();return;}
    sending=true;send.disabled=true;
    try{
      const result=await resendEmailCode(email.control.value.trim(),'reset');
      feedback.replaceChildren(notice(result.message,{tone:'info'}));cooldown(result.retryAfter||60);
    }catch(error){send.disabled=false;feedback.replaceChildren(notice(error.message,{tone:'error'}));if(error.detail?.retryAfter)cooldown(error.detail.retryAfter);}
    finally{sending=false;}
  }
  async function reset() {
    if(resetting || !config.enabled)return;
    errors.hidden=true;for(const f of [email,code,password,confirm])f.setError(null);
    if(!email.control.value.trim()){email.setError('请填写校园邮箱');email.control.focus();return;}
    if(!/^\d{6}$/.test(code.control.value.trim())){code.setError('请输入 6 位重置验证码');code.control.focus();return;}
    const passwordError=passwordPolicyError(password.control.value);
    if(passwordError){password.setError(passwordError);password.control.focus();return;}
    if(password.control.value!==confirm.control.value){confirm.setError('两次输入的密码不一致');confirm.control.focus();return;}
    resetting=true;submit.dataset.loading='true';submit.disabled=true;
    try{
      await resetPassword(email.control.value.trim(),code.control.value.trim(),password.control.value);
      password.control.value='';confirm.control.value='';code.control.value='';
      notify.success('密码已重置','旧会话已失效，请使用新密码登录。');navigate('/login',{replace:true});
    }catch(error){errors.hidden=false;errors.replaceChildren(notice(error.message,{tone:'error'}));}
    finally{resetting=false;delete submit.dataset.loading;submit.disabled=false;}
  }
  const node=h('div',{class:'view'},h('div',{class:'formpage'},
    h('header',{class:'stack-3'},h('a',{href:'/login',class:'t-caption t-muted row-2'},icon('chevronLeft','ico ico--sm'),h('span',{text:'返回登录'})),
      h('h1',{class:'t-h1',text:'通过校园邮箱找回密码'}),
      h('p',{class:'t-prose',text:'适用于已完成邮箱验证的学生账号。查收重置验证码后设置新密码；管理员账号请联系核心负责人处理。'})),
    h('section',{class:'panel'},h('form',{class:'panel__body stack-4',on:{submit:event=>{event.preventDefault();reset();}}},
      email,send,feedback,code,password,confirm,
      h('p',{class:'t-caption t-muted',text:`验证码 10 分钟内有效，仅最新验证码可用。${PASSWORD_HINT} 重置后需要重新登录。`}),
      ...(!config.enabled?[notice('验证码邮件服务暂不可用，请稍后再试。',{tone:'warning'})]:[]),errors,submit))));
  // Touch screens keep the page introduction visible until the user taps a field.
  if (window.matchMedia('(min-width: 861px) and (pointer: fine)').matches) {
    requestAnimationFrame(() => email.control.focus({ preventScroll: true }));
  }
  return {title:'找回密码',node,dispose:()=>clearInterval(timer)};
}
