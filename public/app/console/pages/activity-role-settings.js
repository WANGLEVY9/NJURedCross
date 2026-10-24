import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';
import {ACTIVITY_CATEGORY_OPTIONS} from '../../shared/activity-taxonomy.js';

const labels={R01:'南京综事活动发起与负责',R02:'南京博爱活动发起与负责',R03:'南京生命活动发起与负责',R04:'苏州活动发起与负责',R05:'南京终审',R06:'苏州终审',R11:'平台总权限'};
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
   const hasNanjing=(item.roles||[]).some(role=>['R01','R02','R03','R05'].includes(role));
   const selectedRegion=!hasNanjing&&(item.roles||[]).some(role=>['R04','R06'].includes(role))?'suzhou':'nanjing';
   const regional=h('div',{class:'stack-3'}),summaryText=h('span',{class:'stack-2'});
   const summarize=()=>{const person=data.accounts.find(row=>row.id===item.accountId);summaryText.replaceChildren(h('strong',{text:person?person.name:'请选择平台账号'}),h('small',{class:'t-caption',text:[item.accountId,...(item.roles||[]).map(role=>labels[role]),...(item.initialCategories||[]),...(item.finalCategories||[])].filter(Boolean).join(' · ')||'尚未配置权限'}));};
   function drawRegion(value){regional.replaceChildren(choices(item,'roles',Object.entries(labels).filter(([code])=>value==='suzhou'?['R04','R06'].includes(code):['R01','R02','R03','R05'].includes(code)).map(([code,label])=>[code,`${code} · ${label}`])));
    if(value==='nanjing')regional.append(h('strong',{text:'审批与发布范围（南京终审）'}),choices(item,'finalCategories',ACTIVITY_CATEGORY_OPTIONS.map(value=>[value,value])),h('strong',{text:'专项活动发起与负责范围'}),h('p',{class:'t-caption',text:'博爱、生命、综事由上方对应角色确定；下列专项须同时具有南京活动发起角色。'}),choices(item,'initialCategories',['主席团专项','排班专项','一加助残专项','献血车专项'].map(value=>[value,value])));
    else regional.append(notice('苏州活动发起角色沿用现有苏州类别范围；终审角色用于审批和发布。切换地区仅切换编辑视图，不会删除已配置的另一地区权限。',{tone:'neutral'}));
   }
   const region=field({label:'配置地区',options:[{value:'nanjing',label:'南京主任团／主席团'},{value:'suzhou',label:'苏州主任团／主席团'}],value:selectedRegion,onInput:e=>drawRegion(e.target.value)});drawRegion(selectedRegion);summarize();
   const editor=h('div',{class:'panel__body stack-3'},account,region,regional,h('strong',{text:'跨地区管理权限'}),choices(item,'roles',[['R11','R11 · 平台总权限']]),button({label:'移除此项角色配置',variant:'ghost',onClick:()=>{assignments=assignments.filter(row=>row!==item);render();}}));editor.addEventListener('change',summarize);
   return h('details',{class:'activity-role-entry',open:!item.accountId},h('summary',{class:'row-3 row-wrap'},summaryText,h('span',{class:'t-caption',text:'编辑权限'})),editor);
  }));}
  const save=button({label:'保存活动权限',variant:'primary',onClick:async()=>{
   if(busy)return;busy=true;save.disabled=true;list.inert=true;add.disabled=true;
   try{await request(path,{method:'PUT',body:{version:data.version,assignments}});committed=true;await modal.close();notify.success('活动权限已更新');await onSaved();}
   catch(error){uncertain=!error.status||error.status>=500;reportError(error,'权限配置未保存');message.replaceChildren(notice(uncertain?'保存结果待核对，请关闭后重新打开配置核对，勿重复保存。':'请核对配置后重试。',{tone:'warning'}));}
   finally{busy=false;save.disabled=uncertain;list.inert=uncertain;add.disabled=uncertain;}
  }});
  const add=button({label:'添加账号',onClick:()=>{assignments.push({accountId:'',roles:[],finalCategories:[],initialCategories:[]});render();}});
  render();modal=openModal({title:'活动权限与负责人配置',width:1000,body:h('div',{class:'stack-4'},notice('点击人员行编辑权限，先选择地区，再配置活动发起与负责范围，以及审批与发布范围。主任团提交活动后直接进入对应终审，不增加初审环节。请按账号 ID 核对人员。',{tone:'neutral'}),data.legacyRows?notice(`保留 ${data.legacyRows} 条旧地区配置；同账号的新角色将替代该账号的旧活动范围。`,{tone:'warning'}):null,list,add,message),footer:[button({label:'取消',onClick:()=>modal.close()}),save]});modal.setCloseGuard(()=>committed||!busy);
 }catch(error){reportError(error,'活动权限配置暂不可用');}
}
