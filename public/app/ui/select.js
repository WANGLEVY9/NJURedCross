import {h,icon,setVars} from '../core/dom.js';

let activeMenu=null;
function repositionActive(){if(activeMenu?.popup.isConnected)activeMenu.position();else activeMenu=null;}
window.addEventListener('resize',repositionActive);
document.addEventListener('scroll',repositionActive,true);

/** The native control retains its stable values; optional search only filters the visible choices. */
export function selectMenu(control,label='选择', { searchable = null } = {}) {
  searchable ??= control.options.length > 7;
  if(!HTMLElement.prototype.showPopover){
    const native=h('div',{class:'select-wrap'},control,icon('chevronDown','ico ico--sm'));
    if(!searchable)return {node:native,labelId:control.id};
    const search=h('input',{class:'input',type:'search',placeholder:'输入关键词筛选',autocomplete:'off',aria:{label:`搜索${label}`}});
    const empty=h('p',{class:'select-menu__empty',text:'没有匹配项，试试其他关键词',hidden:true,role:'status'});
    function filter(){
      const query=search.value.normalize('NFKC').trim().toLocaleLowerCase();
      for(const option of control.options)option.hidden=Boolean(query&&!option.textContent.normalize('NFKC').toLocaleLowerCase().includes(query));
      empty.hidden=Array.from(control.options).some(option=>!option.hidden);search.disabled=control.disabled;
    }
    search.addEventListener('input',filter);
    new MutationObserver(filter).observe(control,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    const node=h('div',{class:'select-menu stack-2'},search,native,empty);
    node.syncSelect=()=>{search.value='';filter();};filter();
    return {node,labelId:control.id};
  }
  const nativeId=control.id,triggerId=`${nativeId}-trigger`,listId=`${nativeId}-list`;
  const text=h('span',{class:'select-menu__value'});
  const trigger=h('button',{type:'button',id:triggerId,class:'select-menu__trigger',role:'combobox',aria:{label,haspopup:'listbox',expanded:'false',controls:listId}},text,icon('chevronDown','ico ico--sm'));
  const list=h('div',{id:listId,class:'select-menu__list',role:'listbox',aria:{label}});
  const search=searchable?h('input',{class:'input select-menu__search',type:'search',placeholder:'输入关键词筛选',autocomplete:'off',aria:{label:`搜索${label}`,controls:listId}}):null;
  const empty=h('p',{class:'select-menu__empty',text:'没有匹配项，试试其他关键词',hidden:true,role:'status'});
  const popup=h('div',{class:`select-menu__popup${searchable?' is-searchable':''}`,popover:'auto'},
    search?h('div',{class:'select-menu__search-wrap'},icon('search','ico ico--sm'),search):null,list,empty);
  const wrapper=h('div',{class:'select-menu'},control,trigger,popup);
  control.classList.add('select-menu__native');control.tabIndex=-1;control.setAttribute('aria-hidden','true');
  let active=-1,rows=[],prefix='',lastKey=0;
  const opened=()=>popup.matches(':popover-open');
  function sync(){
    text.textContent=control.selectedOptions[0]?.textContent||'请选择';
    trigger.disabled=control.disabled;
    if(control.disabled&&opened())close();
    trigger.setAttribute('aria-required',String(control.required));
    trigger.setAttribute('aria-invalid',control.getAttribute('aria-invalid')||'false');
    const description=control.getAttribute('aria-describedby');
    if(description)trigger.setAttribute('aria-describedby',description);else trigger.removeAttribute('aria-describedby');
    rows.forEach(row=>row.node.setAttribute('aria-selected',String(row.index===control.selectedIndex)));
  }
  function highlight(index){
    active=index;rows.forEach(row=>row.node.dataset.highlighted=String(row.index===active));
    const row=rows.find(row=>row.index===active);
    for(const target of [trigger,search].filter(Boolean)){
      if(row)target.setAttribute('aria-activedescendant',row.node.id);else target.removeAttribute('aria-activedescendant');
    }
    if(row)row.node.scrollIntoView({block:'nearest'});
  }
  function position(){
    const rect=trigger.getBoundingClientRect(),margin=8;
    const below=innerHeight-rect.bottom-margin,above=rect.top-margin;
    const up=below<Math.min(popup.scrollHeight,320)&&above>below;
    const height=Math.min(320,up?above:below);
    const width=Math.min(Math.max(rect.width,180),innerWidth-2*margin);
    setVars(popup,{'--select-left':`${Math.max(margin,Math.min(rect.left,innerWidth-width-margin))}px`,'--select-width':`${width}px`,'--select-top':`${up?Math.max(margin,rect.top-Math.min(popup.scrollHeight,height)-6):rect.bottom+6}px`,'--select-height':`${Math.max(40,height-6)}px`});
    popup.dataset.side=up?'top':'bottom';
  }
  function close(focus=false){if(opened())popup.hidePopover();if(focus)trigger.focus();}
  function choose(index){if(!control.options[index]||control.options[index].disabled)return;control.selectedIndex=index;sync();close(true);control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));}
  function filter(){
    const query=(search?.value||'').normalize('NFKC').trim().toLocaleLowerCase();
    rows=Array.from(control.options).flatMap((option,index)=>{
      if(query&&!option.textContent.normalize('NFKC').toLocaleLowerCase().includes(query))return [];
      return [{index,node:h('div',{id:`${listId}-${index}`,class:'select-menu__option',role:'option',aria:{label:option.textContent,selected:String(option.selected),disabled:String(option.disabled)},on:{mousedown:event=>event.preventDefault(),click:()=>choose(index)}},h('span',{text:option.textContent}),option.dataset.description?h('span',{class:'select-menu__description','aria-hidden':'true',text:option.dataset.description}):null,option.selected?icon('check','ico ico--sm'):null)}];
    });
    list.replaceChildren(...rows.map(row=>row.node));empty.hidden=rows.length>0;
    const allowed=rows.filter(row=>!control.options[row.index].disabled).map(row=>row.index);
    highlight(allowed.includes(control.selectedIndex)?control.selectedIndex:allowed[0]??-1);
    if(opened())position();
  }
  function open(keyboard=false){
    if(control.disabled)return;
    if(search)search.value='';
    filter();popup.dataset.keyboard=String(keyboard);popup.showPopover();position();
    trigger.setAttribute('aria-expanded','true');
    activeMenu={popup,position};
    if(search)search.focus({preventScroll:true});
  }
  popup.addEventListener('toggle',()=>{if(!opened()){trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');if(activeMenu?.popup===popup)activeMenu=null;}});
  trigger.addEventListener('click',()=>opened()?close():open());
  function navigate(event){
    if(event.isComposing||event.keyCode===229)return;
    if(['ArrowDown','ArrowUp'].includes(event.key)||(['Home','End'].includes(event.key)&&event.target!==search)){
      event.preventDefault();if(!opened())open(true);
      const allowed=rows.filter(row=>!control.options[row.index].disabled).map(row=>row.index);
      const index=allowed.indexOf(active),next=event.key==='Home'?allowed[0]:event.key==='End'?allowed.at(-1):allowed[Math.max(0,Math.min(allowed.length-1,index+(event.key==='ArrowDown'?1:-1)))];
      highlight(next??-1);return;
    }
    if(event.key==='Escape'){if(opened()){event.preventDefault();event.stopPropagation();close(true);}return;}
    if(event.key==='Tab'){close();return;}
    if(event.key==='Enter'||(event.key===' '&&event.target!==search)){event.preventDefault();opened()?choose(active):open(true);return;}
    if(event.target===search)return;
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();if(!opened())open(true);
      if(search){search.value+=event.key;filter();return;}
      prefix=Date.now()-lastKey>700?event.key:prefix+event.key;lastKey=Date.now();
      const index=Array.from(control.options).findIndex(o=>!o.disabled&&o.textContent.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));if(index>=0)highlight(index);
    }
  }
  trigger.addEventListener('keydown',navigate);
  search?.addEventListener('keydown',navigate);
  search?.addEventListener('input',filter);
  control.addEventListener('change',sync);
  control.addEventListener('invalid',event=>{event.preventDefault();trigger.setAttribute('aria-invalid','true');trigger.focus();});
  // Existing pages assign .value directly; keep that contract and the visible label in sync.
  for(const property of ['value','selectedIndex','disabled']){
    const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,property);
    Object.defineProperty(control,property,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
  }
  new MutationObserver(()=>{sync();if(opened())filter();}).observe(control,{attributes:true,childList:true,subtree:true,characterData:true});
  control.addEventListener('focus',()=>trigger.focus());
  wrapper.syncSelect=sync;sync();
  return {node:wrapper,labelId:triggerId};
}

// Native form reset happens after its event; update the visible values afterwards.
document.addEventListener('reset',event=>setTimeout(()=>event.target.querySelectorAll('.select-menu').forEach(node=>node.syncSelect?.()),0),true);
