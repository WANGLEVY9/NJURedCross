import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';
import {ACTIVITY_CATEGORY_OPTIONS} from '../../shared/activity-taxonomy.js';

const labels={R01:'南京综事初审',R02:'南京博爱初审',R03:'南京生命初审',R04:'苏州初审',R05:'南京终审',R06:'苏州终审',R11:'平台总权限'};
export async function configureWorkspaceRoles(onSaved){
 try{
  const path='/api/volunteer/workflow/workspace-drafts/role-settings',data=(await request(path,{fresh:true})).result;
  let assignments=structuredClone(data.assignments),busy=false,uncertain=false,committed=false,modal;
  const list=h('div',{class:'stack-4'}),message=h('div');
  const choices=(item,key,options)=>h('div',{class:'activity-role-choices'},...options.map(([value,label])=>{
   const input=h('input',{type:'checkbox',checked:(item[key]||[]).includes(value),on:{change:()=>{item[key]=input.checked?[...(item[key]||[]),value]:(item[key]||[]).filter(code=>code!==value);}}});
   return h('label',{},input,h('span',{text:label}));
  }));
  function render(){list.replaceChildren(...assignments.map(item=>{
   const account=field({label:'平台账号',value:item.accountId,options:[{value:'',label:'请选择已验证管理账号'},...data.accounts.map(row=>({value:row.id,label:`${row.name}（${row.id}）`}))],onInput:()=>{item.accountId=account.control.value;}});
   return h('section',{class:'activity-role-entry stack-3'},account,choices(item,'roles',Object.entries(labels).map(([code,label])=>[code,`${code} · ${label}`])),h('strong',{text:'南京终审分管类别（R05）'}),choices(item,'finalCategories',ACTIVITY_CATEGORY_OPTIONS.map(value=>[value,value])),h('strong',{text:'专项初审范围（按实际分工配置）'}),choices(item,'initialCategories',['主席团专项','排班专项','一加助残专项','献血车专项'].map(value=>[value,value])),button({label:'移除此项角色配置',variant:'ghost',onClick:()=>{assignments=assignments.filter(row=>row!==item);render();}}));
  }));}
  const save=button({label:'保存活动权限',variant:'primary',onClick:async()=>{
   if(busy)return;busy=true;save.disabled=true;list.inert=true;add.disabled=true;
   try{await request(path,{method:'PUT',body:{version:data.version,assignments}});committed=true;await modal.close();notify.success('活动权限已更新');await onSaved();}
   catch(error){uncertain=!error.status||error.status>=500;reportError(error,'权限配置未保存');message.replaceChildren(notice(uncertain?'保存结果待核对，请关闭后重新打开配置核对，勿重复保存。':'请核对配置后重试。',{tone:'warning'}));}
   finally{busy=false;save.disabled=uncertain;list.inert=uncertain;add.disabled=uncertain;}
  }});
  const add=button({label:'添加账号',onClick:()=>{assignments.push({accountId:'',roles:[],finalCategories:[],initialCategories:[]});render();}});
  render();modal=openModal({title:'活动权限与负责人配置',width:1000,body:h('div',{class:'stack-4'},notice('一级初审由主任团处理，二级终审按地区和分管类别处理。请用账号 ID 核对人员；平台总权限可跨范围处理。',{tone:'neutral'}),data.legacyRows?notice(`保留 ${data.legacyRows} 条旧地区配置；同账号的新角色将替代该账号的旧活动范围。`,{tone:'warning'}):null,list,add,message),footer:[button({label:'取消',onClick:()=>modal.close()}),save]});modal.setCloseGuard(()=>committed||!busy);
 }catch(error){reportError(error,'活动权限配置暂不可用');}
}
