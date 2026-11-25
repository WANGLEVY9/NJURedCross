import {h,icon} from '../../core/dom.js';

/** Compact multi-select for dense console forms; native checkboxes stay accessible. */
export function activityMultiSelect({label,placeholder='请选择',options=[],selected=[],disabled=false,onChange=()=>{}}) {
  const id=`ams-${Math.random().toString(36).slice(2,8)}`;
  const trigger=h('button',{type:'button',id:`${id}-trigger`,class:'activity-multi-select__trigger',role:'combobox',aria:{label,haspopup:'listbox',expanded:'false',controls:`${id}-list`}},h('span',{class:'activity-multi-select__value'}),icon('chevronDown','ico ico--sm'));
  const search=h('input',{class:'input activity-multi-select__search',type:'search',placeholder:'输入姓名筛选',autocomplete:'off',aria:{label:`搜索${label}`,controls:`${id}-list`}});
  const list=h('div',{id:`${id}-list`,class:'activity-multi-select__list',role:'listbox',aria:{label,multiselectable:'true'}});
  const empty=h('p',{class:'activity-multi-select__empty',role:'status',text:'没有匹配项',hidden:true});
  const popup=h('div',{class:'activity-multi-select__popup',popover:'auto'},h('div',{class:'activity-multi-select__search-wrap'},icon('search','ico ico--sm'),search),list,empty);
  const root=h('div',{class:'field activity-multi-select'},h('label',{class:'field__label',for:trigger.id,text:label}),h('div',{class:'activity-multi-select__control'},trigger,popup));
  let choices=options;
  let values=selected;
  let opened=false;

  function current(){return choices.filter(row=>values.includes(row.id));}
  function sync(){
    const picked=current();
    const summary=picked.length?`已选 ${picked.length} 人 · ${picked.slice(0,2).map(row=>row.name).join('、')}${picked.length>2?'…':''}`:placeholder;
    trigger.querySelector('.activity-multi-select__value').textContent=summary;
    trigger.disabled=disabled;
    trigger.dataset.empty=String(!picked.length);
    for(const row of list.querySelectorAll('.activity-multi-select__option')){
      const input=row.querySelector('input');
      input.checked=values.includes(input.value);
      row.setAttribute('aria-selected',String(input.checked));
    }
  }
  function close(focus=false){if(popup.matches(':popover-open'))popup.hidePopover();if(focus)trigger.focus();}
  function position(){
    const rect=trigger.getBoundingClientRect();
    const margin=8;
    const width=Math.min(Math.max(rect.width,260),340,innerWidth-2*margin);
    const below=innerHeight-rect.bottom-margin;
    const above=rect.top-margin;
    const measured=popup.getBoundingClientRect().height||popup.scrollHeight;
    const up=below<Math.min(measured,320)&&above>below;
    const height=Math.max(120,Math.min(320,up?above:below));
    const left=Math.max(margin,Math.min(rect.left,innerWidth-width-margin));
    const top=up?Math.max(margin,rect.top-Math.min(measured,height)-6):rect.bottom+6;
    popup.style.left=`${left}px`;
    popup.style.top=`${top}px`;
    popup.style.width=`${width}px`;
    popup.style.maxHeight=`${height}px`;
    popup.dataset.side=up?'top':'bottom';
  }
  function open(){
    if(disabled)return;
    search.value='';filter();popup.showPopover();
    position();
    trigger.setAttribute('aria-expanded','true');opened=true;
    search.focus({preventScroll:true});
  }
  function filter(){
    const query=search.value.normalize('NFKC').trim().toLocaleLowerCase();
    const rows=choices.filter(row=>!query||row.name.normalize('NFKC').toLocaleLowerCase().includes(query));
    list.replaceChildren(...rows.map(row=>h('label',{class:'activity-multi-select__option',role:'option',aria:{selected:String(values.includes(row.id))}},
      h('input',{type:'checkbox',value:row.id,checked:values.includes(row.id),disabled,on:{change:event=>{
        values=event.target.checked?[...values,row.id]:values.filter(id=>id!==row.id);
        sync();onChange([...values]);
      }}}),h('span',{text:row.name}))));
    empty.hidden=rows.length>0;
  }
  popup.addEventListener('toggle',()=>{if(!popup.matches(':popover-open')){trigger.setAttribute('aria-expanded','false');opened=false;}});
  trigger.addEventListener('click',()=>opened?close():open());
  search.addEventListener('input',filter);
  search.addEventListener('input',position);
  window.addEventListener('resize',()=>{if(opened)position();});
  document.addEventListener('scroll',()=>{if(opened)position();},true);
  search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);}if(event.key==='Tab'&&!event.shiftKey&&!list.querySelector('input'))close();});
  trigger.addEventListener('keydown',event=>{if(['Enter',' ','ArrowDown'].includes(event.key)){event.preventDefault();open();}});
  root.setOptions=(next,nextValues=values)=>{choices=next;values=nextValues.filter(id=>choices.some(row=>row.id===id)||nextValues.includes(id));filter();sync();};
  root.setDisabled=next=>{disabled=next;search.disabled=next;for(const input of list.querySelectorAll('input'))input.disabled=next;sync();};
  root.getValues=()=>[...values];
  filter();sync();
  return root;
}
