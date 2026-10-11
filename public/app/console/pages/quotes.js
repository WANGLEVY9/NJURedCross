import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {pageHead,button,field,segmented,badge,emptyState,notice,runWithLoading} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';
import {asyncRegion} from '../lib.js';

const root='/api/community/quotes';
export default async function quotesPage() {
  let filter='已发布',items=[],ready=false;
  const list=h('div',{class:'quote-wall'});
  const create=button({label:'新增语录',iconName:'plus',onClick:()=>edit()});create.disabled=true;
  const tabs=segmented({items:['已发布','草稿','已下架','全部'].map(value=>({value,label:value})),value:filter,ariaLabel:'语录状态',onChange:value=>{filter=value;tabs.setValue(value);draw();}});
  const view=asyncRegion({errorTitle:'语录墙暂时无法加载',load:()=>request(root),render:data=>{
    items=data.items;ready=data.ready;create.disabled=!ready;draw();
    return h('div',{class:'stack-6'},!ready?notice('语录墙数据表尚未配置，暂时无法保存内容。',{tone:'warning'}):null,
      h('div',{class:'console-section-tabs row-3 row-wrap'},tabs,h('span',{class:'spacer'}),h('span',{class:'t-caption',text:`${items.filter(q=>q.status==='已发布').length} 条已发布 · ${items.length} 条语录`}),button({label:'刷新',variant:'secondary',iconName:'refresh',onClick:()=>view.reload()})),list);
  }});
  function draw(){
    const shown=items.filter(q=>filter==='全部'||q.status===filter);
    list.replaceChildren(...(shown.length?shown.map(q=>h('article',{class:'quote-wall__item'},
      h('div',{class:'row-between'},badge(q.status,{tone:q.status==='已发布'?'success':'neutral'})),
      h('blockquote',{class:'quote-wall__content',text:q.content}),
      h('footer',{class:'quote-wall__footer'},h('div',{class:'stack-1'},h('b',{text:q.author}),h('p',{class:'t-caption',text:q.source||'未填写来源'})),
        h('div',{class:'row-2'},button({label:'编辑',variant:'secondary',size:'sm',onClick:()=>edit(q)}),button({label:q.status==='已发布'?'下架':'发布',variant:'secondary',size:'sm',onClick:()=>setStatus(q)})))))
      :[emptyState({iconName:'quote',title:filter==='全部'?'还没有语录':`暂无${filter}语录`,description:'整理真实的红会故事与寄语，注明署名和来源后发布。'})]));
  }
  function edit(q={}) {
    const content=field({label:'语录内容',multiline:true,rows:5,maxlength:1000,value:q.content||'',required:true,placeholder:'填写真实语录，最多 1000 字'});
    const author=field({label:'署名',value:q.author||'',required:true});
    const source=field({label:'来源',value:q.source||'',placeholder:'活动、日期或出处（选填）'});
    let drawer;const save=button({label:q.id?'保存修改为草稿':'保存草稿',onClick:async()=>{
      try{await runWithLoading(save,()=>request(q.id?`${root}/${q.id}`:root,{method:q.id?'PATCH':'POST',body:{content:content.control.value,author:author.control.value,source:source.control.value,status:'草稿'}}));drawer.close();notify.success('语录已保存');filter='草稿';tabs.setValue(filter);await view.reload();}catch(error){reportError(error,'语录未保存');}
    }});
    drawer=openDrawer({eyebrow:'红会语录墙',title:q.id?'编辑语录':'新增语录',body:[notice('修改后保存为草稿，确认内容后再发布。',{tone:'neutral'}),content,author,source],footer:[save]});
  }
  async function setStatus(q){
    const status=q.status==='已发布'?'已下架':'已发布';
    if(!await confirmAction({title:`${status==='已发布'?'发布':'下架'}这条语录？`,description:status==='已发布'?'发布后显示在管理端语录墙。':'下架后移出已发布视图，内容仍会保留。',confirmLabel:status==='已发布'?'发布':'下架'}))return;
    try{await request(`${root}/${q.id}`,{method:'PATCH',body:{...q,status}});notify.success(status==='已发布'?'语录已发布':'语录已下架');await view.reload();}catch(error){reportError(error,'状态未更新');}
  }
  return {title:'红会语录墙',crumb:'红会语录墙',node:h('div',{class:'view wspad wspad--wide stack-6'},pageHead({title:'红会语录墙',description:'留住值得记住的话，让每一段寄语有署名、有出处。',actions:[create]}),view)};
}
