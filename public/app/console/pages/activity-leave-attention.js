import {h} from '../../core/dom.js';
import {button} from '../../ui/primitives.js';

/** Decorative count keeps the position's accessible name stable for tab navigation. */
export function markPositionLeave(tab,count){
  if(!count)return;
  tab.classList.add('has-pending-leave');
  tab.setAttribute('aria-description',`${count} 条请假待审批`);
  tab.title=`${count} 条请假待审批`;
  tab.append(h('span',{class:'activity-position-leave-count','aria-hidden':'true',text:count>99?'99+':String(count)}));
}

export function leaveAttention({onOpen}){
  let target='';
  const message=h('p'),hint=h('p',{class:'t-caption'});
  const open=button({label:'查看待审批请假',size:'sm',onClick:()=>onOpen(target)});
  const node=h('aside',{class:'activity-leave-attention','aria-label':'请假待办提示','aria-live':'polite'},h('div',{class:'stack-1'},message,hint),open);
  node.hidden=true;
  return {node,update(summary,active,{disabled=false}={}){
    const pending=[...summary].filter(([,value])=>value.pending>0),total=pending.reduce((sum,[,value])=>sum+value.pending,0);
    node.hidden=!total;open.disabled=disabled;
    target=summary.get(active)?.pending?active:pending[0]?.[0]||'';
    const text=`有 ${total} 条请假待审批`,description=summary.get(active)?.pending?`当前岗位 ${summary.get(active).pending} 条；带数字角标的岗位有待处理申请。`:'其他岗位有待处理申请，可通过入口前往查看。';
    if(message.textContent!==text)message.textContent=text;
    if(hint.textContent!==description)hint.textContent=description;
  }};
}
