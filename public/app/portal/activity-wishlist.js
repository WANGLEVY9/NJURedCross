import {h} from '../core/dom.js';
import {publicApi,request} from '../core/api.js';
import {button,runWithLoading} from '../ui/primitives.js';
import {asyncRegion} from '../console/lib.js';
import {notify,reportError} from '../core/toast.js';
import {workflowEventPath} from './workflow-links.js';
import {wishCollection} from './booking-presentation.js';

export function activityWishlist({authenticated,onChange,loginHref}) {
 let items=[];
 const node=authenticated?asyncRegion({load:async()=>{
  const [catalogue,data,workflow]=await Promise.all([publicApi.events(),request('/api/portal/workflow/wishlist'),request('/api/public/workflow/events').catch(()=>({events:[]}))]);
  items=data.wishlist;
  const events=catalogue.events.map(event=>{const id=event.workflowId||`managed:${event.eventId}`;return {...event,id,date:String(event.startAt||'').slice(0,10),slot:event.schedule||'',href:event.workflowId?workflowEventPath({id,blood:event.blood}):`/events/${encodeURIComponent(event.eventId)}`};});
  for(const event of workflow.events)if(!events.some(item=>item.id===event.id))events.push(event);
  return {events,items};
 },render:({events,items})=>wishCollection(events,items,item=>toggle(item.eventId,true))}):null;
 function toggle(id,subscribed){let control;control=button({label:subscribed?'取消空位提醒':'加入心愿清单',iconName:'heart',variant:'secondary',onClick:async()=>{
  try{await runWithLoading(control,()=>request(`/api/portal/workflow/events/${encodeURIComponent(id)}/wishlist`,{method:subscribed?'DELETE':'POST',body:{}}));await node.reload();await onChange?.();notify.success(subscribed?'已取消空位提醒':'已加入心愿清单');}catch(error){reportError(error,'心愿清单更新未完成');}
 }});return control;}
 function fullSignup(event){const id=event.id||`managed:${event.eventId}`;const subscribed=items.some(item=>item.eventId===id);
  return h('div',{class:'vacancy-callout'},h('div',{},button({label:'已报满',variant:'secondary',disabled:true,block:true}),h('p',{text:subscribed?'已关注此活动，空位提醒将发送到你的账号邮箱。提醒不预留名额。':'加入心愿清单，有空位时接收邮件提醒；提醒不预留名额。'})),authenticated?toggle(id,subscribed):button({label:'登录后关注',href:loginHref(event),variant:'secondary'}));
 }
 return {node,reload:()=>node?.reload(),fullSignup};
}
