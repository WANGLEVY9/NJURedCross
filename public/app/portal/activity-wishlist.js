import {h} from '../core/dom.js';
import {publicApi,request} from '../core/api.js';
import {panel,button,runWithLoading} from '../ui/primitives.js';
import {asyncRegion} from '../console/lib.js';
import {notify,reportError} from '../core/toast.js';
import {workflowEventPath} from './workflow-links.js';

export function activityWishlist({authenticated,onChange,loginHref}) {
 let items=[];
 const node=authenticated?asyncRegion({load:async()=>{
  const [catalogue,data]=await Promise.all([publicApi.events(),request('/api/portal/workflow/wishlist')]);
  items=data.wishlist;
  return {events:catalogue.events,items};
 },render:({events,items})=>panel({title:'我的心愿清单',body:h('div',{class:'stack-3'},
  h('p',{class:'t-secondary',text:'关注已报满的活动，空位出现后通过邮箱提醒。提醒不预留名额。'}),
  ...items.map(item=>{
   const event=events.find(e=>(e.workflowId||`managed:${e.eventId}`)===item.eventId);
   const href=item.eventId.startsWith('managed:')?`/events/${encodeURIComponent(item.eventId.slice(8))}`:workflowEventPath({id:item.eventId,blood:event?.blood});
   return h('div',{class:'blood-wish-row'},h('div',{},h('b',{text:event?.name||'已关注活动'}),h('p',{class:'t-caption',text:event?[event.schedule||String(event.startAt||'').slice(0,10),event.location].filter(Boolean).join(' · '):'活动暂未开放，可取消提醒。'})),h('div',{class:'row-2'},button({label:'查看活动',size:'sm',href}),toggle(item.eventId,true)));
  }),!items.length?h('p',{class:'t-caption',text:'尚未关注活动。活动已报满时，可加入心愿清单。'}):null)})}):null;
 function toggle(id,subscribed){let control;control=button({label:subscribed?'取消空位提醒':'加入心愿清单',iconName:'heart',variant:'secondary',onClick:async()=>{
  try{await runWithLoading(control,()=>request(`/api/portal/workflow/events/${encodeURIComponent(id)}/wishlist`,{method:subscribed?'DELETE':'POST',body:{}}));await node.reload();await onChange?.();notify.success(subscribed?'已取消空位提醒':'已加入心愿清单');}catch(error){reportError(error,'心愿清单更新未完成');}
 }});return control;}
 function fullSignup(event){const id=event.id||`managed:${event.eventId}`;const subscribed=items.some(item=>item.eventId===id);
  return h('div',{class:'vacancy-callout'},h('div',{},button({label:'已报满',variant:'secondary',disabled:true,block:true}),h('p',{text:subscribed?'已关注此活动，空位提醒将发送到你的账号邮箱。提醒不预留名额。':'加入心愿清单，有空位时接收邮件提醒；提醒不预留名额。'})),authenticated?toggle(id,subscribed):button({label:'登录后关注',href:loginHref(event),variant:'secondary'}));
 }
 return {node,reload:()=>node?.reload(),fullSignup};
}
