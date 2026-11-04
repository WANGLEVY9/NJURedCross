import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';

export async function openDuplicatePeople(){
 const body=h('div',{class:'stack-4'},h('p',{text:'正在检测账号表和个人主页表…'}));let disposed=false;
 const dialog=openModal({title:'重复人员检测',width:900,body,footer:[button({label:'关闭',onClick:()=>dialog.close()})],onClose:()=>{disposed=true;}});
 dialog.surface.classList.add('hours-sync-modal');
 try{const result=await request('/api/auth/duplicate-people',{fresh:true});if(disposed)return;
  body.replaceChildren(notice(`已检查 ${result.checkedAccounts} 个账号、${result.checkedProfiles} 条个人主页；发现 ${result.total} 组重复或身份冲突。检测只读取数据，请核对后处理。`,{tone:result.total?'warning':'success'}),...result.groups.map(group=>h('section',{class:'stack-2'},h('strong',{text:`学号 ${group.studentId}${group.identityConflict?' · 姓名冲突':''}`}),...group.rows.map(row=>h('p',{class:'t-caption',text:`${row.source} · ${row.name||'未填写姓名'} · 行ID ${row.id}`})))),...(result.total>result.groups.length?[h('p',{text:'当前展示前200组，请分批核对后重新检测。'})]:[]));
 }catch{if(!disposed)body.replaceChildren(notice('检测未完成，请检查数据源连接后关闭并重试。',{tone:'error'}));}
}
