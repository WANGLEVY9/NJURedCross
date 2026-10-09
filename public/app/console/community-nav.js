import { h } from '../core/dom.js';
import { button } from '../ui/primitives.js';
export function communityModuleNav(active) {
 return h('nav',{class:'row-3 row-wrap',aria:{label:'内建管理模块'}},
  button({label:'生日祝福',href:'/console/community/birthday',variant:active==='birthday'?'primary':'secondary'}),
  button({label:'早安晚安',href:'/console/community/morning',variant:active==='morning'?'primary':'secondary'}));
}
