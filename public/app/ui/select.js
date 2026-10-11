import {h,icon,setVars} from '../core/dom.js';

let activeMenu=null;
function repositionActive(){if(activeMenu?.popup.isConnected)activeMenu.position();else activeMenu=null;}
window.addEventListener('resize',repositionActive);
document.addEventListener('scroll',repositionActive,true);

/** A select-only combobox backed by the original form control. */
export function selectMenu(control,label='选择') {
  if(!HTMLElement.prototype.showPopover)return {node:h('div',{class:'select-wrap'},control,icon('chevronDown','ico ico--sm')),labelId:control.id};
  const nativeId=control.id,triggerId=`${nativeId}-trigger`,listId=`${nativeId}-list`;
  const text=h('span',{class:'select-menu__value'});
  const trigger=h('button',{type:'button',id:triggerId,class:'select-menu__trigger',role:'combobox',aria:{label,haspopup:'listbox',expanded:'false',controls:listId}},text,icon('chevronDown','ico ico--sm'));
  const list=h('div',{id:listId,class:'select-menu__list',role:'listbox',aria:{label}});
  const search=h('input',{class:'select-menu__search input',type:'search',placeholder:'搜索选项','aria-label':`搜索${label}`,role:'combobox',aria:{controls:listId,haspopup:'listbox',expanded:'true',autocomplete:'list'}});
  const empty=h('p',{class:'select-menu__empty',hidden:true,role:'status',text:'没有匹配选项'});
  const popup=h('div',{class:'select-menu__popup',popover:'auto'},search,list,empty);
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
    rows.forEach((row,i)=>row.setAttribute('aria-selected',String(i===control.selectedIndex)));
  }
  function highlight(index){
    active=index;rows.forEach((row,i)=>row.dataset.highlighted=String(i===active));
    for(const node of [trigger,search])node.removeAttribute('aria-activedescendant');
    if(rows[active]){trigger.setAttribute('aria-activedescendant',rows[active].id);search.setAttribute('aria-activedescendant',rows[active].id);rows[active].scrollIntoView({block:'nearest'});}
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
    const needle=search.value.trim().toLocaleLowerCase();
    rows.forEach(row=>{row.hidden=!row.textContent.toLocaleLowerCase().includes(needle);});
    const allowed=rows.map((_row,i)=>i).filter(i=>!rows[i].hidden&&!control.options[i].disabled);
    empty.hidden=allowed.length>0;
    highlight(allowed.includes(control.selectedIndex)?control.selectedIndex:allowed[0]);
    position();
  }
  search.addEventListener('input',filter);
  function open(keyboard=false){
    if(control.disabled)return;
    rows=Array.from(control.options,(option,i)=>h('div',{id:`${listId}-${i}`,class:'select-menu__option',role:'option',aria:{selected:String(option.selected),disabled:String(option.disabled)},on:{mousedown:event=>event.preventDefault(),click:()=>choose(i)}},h('span',{text:option.textContent}),option.selected?icon('check','ico ico--sm'):null));
    search.hidden=control.options.length<=7;search.value='';empty.hidden=true;
    list.replaceChildren(...rows);popup.dataset.keyboard=String(keyboard);popup.showPopover();position();
    trigger.setAttribute('aria-expanded','true');highlight(control.selectedIndex>=0?control.selectedIndex:0);
    activeMenu={popup,position};
    if(!search.hidden)search.focus();
  }
  popup.addEventListener('toggle',()=>{if(!opened()){trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');if(activeMenu?.popup===popup)activeMenu=null;}});
  trigger.addEventListener('click',()=>opened()?close():open());
  function keys(event){
    if(event.isComposing)return;
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();if(!opened())open(true);
      const allowed=Array.from(control.options,(_o,i)=>i).filter(i=>!control.options[i].disabled&&!rows[i]?.hidden);
      const index=allowed.indexOf(active),next=event.key==='Home'?allowed[0]:event.key==='End'?allowed.at(-1):allowed[Math.max(0,Math.min(allowed.length-1,index+(event.key==='ArrowDown'?1:-1)))];
      highlight(next);return;
    }
    if(event.key==='Escape'){if(opened()){event.preventDefault();event.stopPropagation();close(true);}return;}
    if(event.key==='Tab'){close();return;}
    if(event.key==='Enter'||event.key===' '&&event.currentTarget===trigger){event.preventDefault();opened()?choose(active):open(true);return;}
    if(event.currentTarget===trigger&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();if(!opened())open(true);prefix=Date.now()-lastKey>700?event.key:prefix+event.key;lastKey=Date.now();
      const index=Array.from(control.options).findIndex(o=>!o.disabled&&o.textContent.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));if(index>=0)highlight(index);
    }
  }
  trigger.addEventListener('keydown',keys);search.addEventListener('keydown',keys);
  control.addEventListener('change',sync);
  control.addEventListener('invalid',event=>{event.preventDefault();trigger.setAttribute('aria-invalid','true');trigger.focus();});
  // Existing pages assign .value directly; keep that contract and the visible label in sync.
  for(const property of ['value','selectedIndex','disabled']){
    const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,property);
    Object.defineProperty(control,property,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
  }
  new MutationObserver(sync).observe(control,{attributes:true,childList:true,subtree:true,characterData:true});
  control.addEventListener('focus',()=>trigger.focus());
  wrapper.syncSelect=sync;sync();
  return {node:wrapper,labelId:triggerId};
}

// Native form reset happens after its event; update the visible values afterwards.
document.addEventListener('reset',event=>setTimeout(()=>event.target.querySelectorAll('.select-menu').forEach(node=>node.syncSelect?.()),0),true);
