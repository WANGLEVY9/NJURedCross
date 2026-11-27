import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {navigate} from '../../core/router.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';
import {DUTY_CAPACITY} from '../../shared/special-activity.js';

export function openRegistryEnable(){
 const type=field({label:'登记项目',options:[{value:'province-service',label:'省血液献血车'},{value:'component-donation',label:'成分献血'}]}),capacity=field({label:'省血液献血车每日名额',type:'number',min:1,max:100000,step:1,required:true,value:'4'});
 let modal,busy=false;
 const enable=button({label:'启用并开始登记',variant:'primary',onClick:async()=>{
  if(busy||type.control.value==='province-service'&&!capacity.control.reportValidity())return;
  busy=true;enable.disabled=true;
  try{
   const {result}=await request('/api/volunteer/workflow/special-registries',{method:'POST',body:{v:1,type:type.control.value,...(type.control.value==='province-service'?{dailyCapacity:Number(capacity.control.value)}:{})}});
   busy=false;await modal.close();await navigate('/console/events?event='+encodeURIComponent(result.id));
  }catch(error){reportError(error,'启用结果需核对');}finally{busy=false;enable.disabled=false;}
 }});
 type.control.addEventListener('change',()=>{capacity.hidden=type.control.value!=='province-service';});
 modal=openModal({title:'启用长期登记项目',body:h('div',{class:'stack-3'},notice('项目沿用排班专项权限，不设自动结束时间；可手动结束。重复启用会打开原项目，不会复制记录。',{tone:'neutral'}),type,capacity),footer:[button({label:'取消',onClick:()=>modal.close()}),enable]});
 modal.setCloseGuard(()=>!busy);
}

export async function openRecurringDuty(){
 try{
  const url='/api/volunteer/workflow/recurring-duty',data=(await request(url,{fresh:true})).result;
  let modal,busy=false;
  const mode=field({label:'开放周次方式',value:data.mode||'rolling',options:[{value:'rolling',label:'自动延续本周及后两周'},{value:'manual',label:'手动选择开放周次'}]});
  const rollingWeeks=Array.from({length:3},(_,i)=>new Date(Date.parse(data.currentWeek+'T00:00:00Z')+i*7*86400000).toISOString().slice(0,10));
  const selected=new Set((data.mode==='manual'?data.weeks||[]:rollingWeeks).filter(week=>week>=data.currentWeek));
  const candidates=[...new Set([...Array.from({length:12},(_,i)=>new Date(Date.parse(data.currentWeek+'T00:00:00Z')+i*7*86400000).toISOString().slice(0,10)),...selected])].sort();
  const choices=h('div',{class:'stack-2'},...candidates.map(week=>h('label',{class:'row-2'},h('input',{type:'checkbox',checked:selected.has(week),on:{change:e=>e.target.checked?selected.add(week):selected.delete(week)}}),h('span',{text:week+' 起的一周'}))));
  const show=()=>{choices.hidden=mode.control.value!=='manual';};mode.control.addEventListener('change',show);show();
  const saveWeeks=button({label:'保存开放周次',onClick:async()=>{
   if(busy)return;busy=true;saveWeeks.disabled=true;toggle.disabled=true;
   try{await request(url,{method:'POST',body:{enabled:data.enabled,mode:mode.control.value,weeks:[...selected].sort()}});busy=false;await modal.close();await navigate('/console/events');}
   catch(error){reportError(error,'开放周次保存失败');}finally{busy=false;saveWeeks.disabled=false;toggle.disabled=false;}
  }});
  const toggle=button({label:data.enabled?'暂停新报名':'启用常态排班',variant:'primary',onClick:async()=>{
   if(busy)return;busy=true;toggle.disabled=true;
   try{await request(url,{method:'POST',body:{enabled:!data.enabled,mode:mode.control.value,weeks:[...selected].sort()}});busy=false;await modal.close();await navigate('/console/events');}
   catch(error){reportError(error,'值班开关保存结果需核对');}finally{busy=false;toggle.disabled=false;}
  }});
  modal=openModal({title:'省红会组宣部值班',body:h('div',{class:'stack-3'},notice(data.enabled?'常态排班已启用':'常态排班未启用',{tone:'neutral'}),h('p',{text:`周一至周五，09:00–12:00、14:00–17:00，每班${DUTY_CAPACITY}人。报名提前24小时截止。默认交通/培训/服务时长为1/1/3小时。`}),mode,choices,h('p',{class:'t-caption',text:'自动模式持续开放三周；手动模式只开放勾选周次，不自动增加。取消勾选只关闭新报名，保留已有报名、签到和时长。暂停期间保存设置不会启用报名。'})),footer:[button({label:'取消',onClick:()=>modal.close()}),saveWeeks,toggle]});modal.setCloseGuard(()=>!busy);
 }catch(error){reportError(error,'值班配置读取失败');}
}
