import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {navigate} from '../../core/router.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {reportError} from '../../core/toast.js';

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
