import { h, icon, clear } from '../../core/dom.js';
import { getSessionState, hasPermission } from '../../core/api.js';
import { patchQuery } from '../../core/router.js';
import { pageHead, button, segmented, definitionList, badge } from '../../ui/primitives.js';
import { CONSOLE_SECTIONS } from '../navigation.js';
import { region } from '../lib.js';
import settingsPage from './settings.js';

export default async function adminPage(context) {
  const user = getSessionState().user || {};
  const views = [{value:'profile',label:'我的账号'},{value:'workspace',label:'工作区偏好'},
    ...(hasPermission('settings') ? [{value:'status',label:'系统状态'},{value:'audit',label:'操作记录'}] : [])];
  let active = views.some(v => v.value === context.query.get('view')) ? context.query.get('view') : 'profile';
  const body = h('div',{class:'stack-6'});
  let generation=0;
  const tabs=segmented({items:views,value:active,ariaLabel:'管理员中心视图',onChange:value=>{active=value;tabs.setValue(value);patchQuery({view:value},{navigate:false});draw();}});
  async function draw() {
    const current=++generation;clear(body);
    if(active==='profile') {
      body.append(region({title:'当前账号',description:'账号资料与本次会话的管理权限。',body:h('div',{class:'admin-profile'},
        h('div',{class:'admin-profile__identity'},h('span',{class:'admin-profile__avatar'},icon('user')),h('div',{},h('h2',{text:user.label||user.username||'管理员'}),h('p',{class:'t-caption',text:user.roleLabel||'运营管理员'}))),
        definitionList([['登录账号',user.username||'—'],['账号角色',user.roleLabel||user.role||'—']]),
        h('div',{class:'admin-profile__permissions'},...CONSOLE_SECTIONS.filter(s=>s.scope&&hasPermission(s.scope)).map(s=>badge(s.label,{tone:'neutral'}))),
        h('div',{class:'row-3 row-wrap'},button({label:'维护个人资料',href:'/me',variant:'secondary',iconName:'user'}),button({label:'修改登录密码',href:'/change-password',variant:'secondary',iconName:'lock'})))}));
      if(hasPermission('data'))body.append(region({title:'数据维护',description:'查看业务表与字段。业务操作应优先在对应管理板块完成。',body:button({label:'打开数据维护',href:'/console/data',variant:'secondary',iconName:'table'})}));
    } else {
      const result=await settingsPage({embedded:true,initialTab:active});
      if(current===generation)body.append(result.node);
    }
  }
  draw();
  return {title:'管理员中心',crumb:'管理员中心',node:h('div',{class:'view wspad wspad--wide stack-6'},
    pageHead({title:'管理员中心',description:'管理自己的账号与工作区，查看系统状态和操作记录。'}),
    h('div',{class:'console-section-tabs'},tabs),body),dispose:()=>{generation++;}};
}
