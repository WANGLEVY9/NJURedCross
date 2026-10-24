import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMutationQueue} from '../events/safety.js';

export const GUIDE_SOURCE='https://table.nju.edu.cn/apps/custom/njurczhiyuan/?page_id=Fpoa';
export const TEMPLATE_TYPES=[['registration-success','报名成功'],['participation-reminder','活动参与提醒'],['registration-result','报名未入选'],['leave-result','请假审批结果'],['approval','活动待审批'],['publication','活动审批通过与发布'],['hours','最终时长表'],['vacancy','班次空位提醒'],['security-code','邮箱验证码'],['security','账号安全通知'],['birthday','生日祝福'],['morning','早安晚安'],['outreach','宣传任务与审核'],['other','其他业务邮件']];
const success='亲爱的志愿者 {姓名}：\n\n恭喜您成功报名南大红会-{活动类别}志愿服务\n\n您的报名信息为：\n{报名信息}\n\n{入群信息}\n\n{注意事项}\n\n如需请假，请前往平台“我的报名”申请：{报名网址}\n\n祝好！\n\n南京大学红十字会';
const reminder='亲爱的志愿者 {姓名}：\n\n您报名的南大红会-{活动类别}志愿服务将于明天开展，期待您的参与！\n\n活动名称：{活动名称}\n服务时间：{日期} {时段}\n服务地点：{地点}\n服务岗位：{岗位}\n\n请提前核对点位、完成前期培训，并按活动要求签到。\n\n{QQ群号}\n{邀请链接}\n{注意事项}\n\n如需请假，请前往平台“我的报名”申请：{报名网址}\n查看报名：{报名网址}\n\n祝好！\n\n南京大学红十字会';
export const MAIL_VARIABLES=['报名信息','入群信息','姓名','活动类别','活动名称','QQ群号','邀请链接','注意事项','反馈表链接','日期','时段','地点','岗位','报名网址','原主题','原正文'];
export function defaultMailSettings(){return {version:0,templates:Object.fromEntries(TEMPLATE_TYPES.map(([id])=>[id,{subject:id==='registration-success'?'南大红会｜{活动名称}报名成功':id==='participation-reminder'?'南大红会｜明日活动参与提醒：{活动名称}':'{原主题}',text:id==='registration-success'?success:id==='participation-reminder'?reminder:'{原正文}'}])),defaults:{reminderTime:'18:00',qqGroup:'',invitation:'',notes:'',feedbackUrl:'https://table.nju.edu.cn/apps/custom/njurczhiyuan/?page_id=v1h4'},guide:{overview:'本活动为预报名，报名结果需等待市血液中心确认。\n填写排班表后需完成市血液献血车初级培训。\n累计服务20小时后，可申请成为市血液中心“正式志愿者”。',training:'申请成为志愿者\n1. 进入公众号“南京红十字血液中心”，点击“发现”—“志愿者”。\n2. 点击“申请成为志愿者”。\n3. 按提示填写申请资料，等待审核通知。\n\n完成初级培训\n4. 按指引操作，直至页面中“考试”显示“已完成”，耐心等待市血液中心短信。\n\n未收到短信时\n若长时间未收到短信，请自查个人信息是否填写正确，以及是否开启短信屏蔽。',location:'新街口中央·献血屋\n服务时间：11~15点（上午）、14~18点（下午）。\n具体地点：新街口地铁站14号口处。\n\n新街口印象汇·献血屋\n服务时间：10~14点（上午）、13~17点（下午）。\n具体地点：新街口地铁站14号口出，左转至印象汇附近（明亮眼镜旁）。\n\n仙林学则路·献血屋\n服务时间：14~18点（下午）。\n具体地点：学则路地铁站2号口出，苏果超市附近。\n\n浦口弘阳广场·流动献血车\n服务时间：11~15点（上午）、15~19点（下午）。\n具体地点：毛纺厂路地铁站2A号口出，弘阳家居建材馆1号门。\n\n请以所报名班次的最新安排为准。',hours:'时长查看\n微信小程序搜索“南京红十字血液中心”，点击“个人中心”—“志愿者服务”—“工时记录”，查看当天具体工作记录和对应时长。\n\n累计服务20小时后，可申请为市血液中心“正式志愿者”。网站正式时长以核验和审核入账结果为准。',checkin:'见习志愿者（未满20小时）\n在签到系统中拍照上传“粉色纸质签到表”。\n\n正式志愿者（已满20小时）\n在签到系统中截图上传“志愿者工时记录”。\n① 微信小程序搜索“南京红十字血液中心”，点击“个人中心”。\n② 点击“志愿者服务”，查看个人信息。\n③ 点击“工时记录”，将当天具体工作记录和对应时长页面截屏上传。',trainingImage:'/assets/blood-guide/training-reference.png',locationImage:'/assets/blood-guide/location-reference.png',hoursImage:'',checkinImage:'/assets/blood-guide/checkin-reference.png'}};}
let current=defaultMailSettings();
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const urlOK=value=>!value||/^https:\/\/[^\s]+$/.test(value);
function validate(data){
 if(!data||typeof data!=='object'||Object.keys(data).some(k=>!['version','templates','defaults','guide'].includes(k))||!Number.isSafeInteger(data.version))throw fail('配置格式无效');
 const defaults=defaultMailSettings();
 for(const group of ['templates','defaults','guide'])if(!data[group]||Object.keys(data[group]).some(k=>!Object.hasOwn(defaults[group],k))||Object.keys(defaults[group]).some(k=>!Object.hasOwn(data[group],k)))throw fail('配置字段不完整');
 for(const [id,t]of Object.entries(data.templates)){
  if(!t||Object.keys(t).some(k=>!['subject','text'].includes(k))||typeof t.subject!=='string'||!t.subject.trim()||t.subject.length>300||/[\r\n]/.test(t.subject)||typeof t.text!=='string'||!t.text.trim()||t.text.length>20000)throw fail('邮件主题或正文格式无效');
  for(const match of (t.subject+'\n'+t.text).matchAll(/\{([^{}]+)\}/g))if(!MAIL_VARIABLES.includes(match[1]))throw fail('未知模板变量：'+match[1]);
  if(['security-code','security'].includes(id)&&!t.text.includes('{原正文}'))throw fail('安全邮件必须保留 {原正文}，以免遗漏验证码或安全提示');
 }
 for(const [key,value]of Object.entries(data.defaults))if(typeof value!=='string'||value.length>4000||(['feedbackUrl','invitation'].includes(key)&&!urlOK(value)))throw fail('邮件公共信息格式无效');
 for(const [key,value]of Object.entries(data.guide))if(typeof value!=='string'||value.length>20000||(key.endsWith('Image')&&value.split('\n').some(url=>url&&!urlOK(url)&&!/^\/assets\/blood-guide\/[A-Za-z0-9_.-]+$/.test(url))))throw fail('说明文字或图片网址格式无效');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.defaults.reminderTime))throw fail('提醒时间格式无效');
 return structuredClone(data);
}
export async function openMailSettings(path){
 try{current=validate(JSON.parse(await readFile(path,'utf8')));}catch(error){if(error.code!=='ENOENT')throw fail('邮件模板配置无法读取，请恢复配置文件',503);current=defaultMailSettings();}
 const serial=createMutationQueue();
 return {read:()=>structuredClone(current),save:body=>serial(async()=>{
  const next=validate(body);if(next.version!==current.version)throw fail('配置已被修改，请刷新后重试',409);next.version++;
  await mkdir(dirname(path),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,JSON.stringify(next,null,2),{flag:'wx',mode:0o600});await rename(temp,path);current=next;}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return structuredClone(next);
 })};
}
export const mailSettingsSnapshot=()=>structuredClone(current);
export const publicParticipationGuide=()=>({...current.guide,source:GUIDE_SOURCE});
export function eventMailVariables(event,row={},origin='https://njuredcross.cn'){
 let c;try{c=JSON.parse(event['报名页配置']||'{}');}catch{c={};}
 const details=[event['活动名称']||'志愿活动',`服务岗位：${row['岗位']||event['岗位']||'未填写'}`,`服务时间：${row['报名日期']||event['报名日期']||''} ${row['报名时段']||event['报名时段']||''}`,`服务地点：${row['地点']||event['地点']||'未填写'}`].join('\n');
 const group=c.registrationContact?.qqGroup||event['QQ群号']||row['QQ群号']||current.defaults.qqGroup,invitation=c.registrationContact?.invitation||event['邀请链接']||row['邀请链接']||current.defaults.invitation;
 return {'报名信息':details,'入群信息':[group?'QQ群号：'+group:'',invitation?'入群链接：'+invitation:''].filter(Boolean).join('\n'),'姓名':row['姓名']||'同学','活动名称':event['活动名称']||'志愿活动','活动类别':event['组织类别']||event['活动类别']||c.center||'志愿服务','QQ群号':c.registrationContact?.qqGroup||event['QQ群号']||row['QQ群号']||current.defaults.qqGroup,'邀请链接':c.registrationContact?.invitation||event['邀请链接']||row['邀请链接']||current.defaults.invitation,'注意事项':c.registrationContact?.notes||event['注意事项']||row['注意事项']||current.defaults.notes,'反馈表链接':current.defaults.feedbackUrl,'日期':row['报名日期']||event['报名日期']||'','时段':row['报名时段']||event['报名时段']||'','地点':event['地点']||row['地点']||'','岗位':row['岗位']||event['岗位']||'','报名网址':new URL(origin).origin+'/workflow-events?event='+encodeURIComponent(event._id)};
}
function typeOf(m){
 if(m.templateId&&current.templates[m.templateId])return m.templateId;
 const key=String(m.idempotencyKey||'');
 if(key.startsWith('APPROVAL:'))return 'approval';if(key.startsWith('PUBLICATION:'))return 'publication';if(key.startsWith('WF-LEAVE:'))return 'leave-result';
 if(m.kind==='verification')return 'security-code';
 if(m.kind==='security')return /验证码/.test(m.subject)?'security-code':'security';
 if(m.kind==='workflow-hours')return 'hours';if(m.kind==='blood-vacancy')return 'vacancy';
 if(/birthday|生日/.test(m.kind+' '+m.subject))return 'birthday';if(/morning|早安|晚安/.test(m.kind+' '+m.subject))return 'morning';if(/outreach|任务|稿件/.test(m.kind+' '+m.subject))return 'outreach';
 if(m.kind==='workflow-result')return 'registration-result';return 'other';
}
export function applyMailTemplate(message){
 if(message.templateRendered)return message;
 const t=current.templates[typeOf(message)],vars={...eventMailVariables({}),...message.templateVariables,'原主题':message.subject||'','原正文':message.text||''};
 const render=value=>value.replace(/\{([^{}]+)\}/g,(_,key)=>String(vars[key]??''));
 return {...message,subject:render(t.subject).replace(/[\r\n]+/g,' ').slice(0,300),text:render(t.text).replace(/\n{4,}/g,'\n\n\n'),templateRendered:true};
}
