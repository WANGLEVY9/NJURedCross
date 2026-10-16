import {h} from '../core/dom.js';

/** A compact multi-person picker. Stable account IDs are the only submitted values. */
export function peoplePicker({label, people = [], selected = [], locked = [], onChange = () => {}}) {
  const fixed = new Set(locked);
  const values = new Set([...fixed,...selected]);
  const root = h('div', {class:'people-picker'});
  const tokens = h('div', {class:'people-picker__tokens',aria:{label:`已选${label}`}});
  const search = h('input', {class:'input',type:'search',placeholder:'搜索姓名或学号',autocomplete:'off',aria:{label:`搜索${label}`}});
  const results = h('div', {class:'people-picker__results'});
  const count = h('p', {class:'t-caption',role:'status'});
  const toggle = h('summary', {class:'people-picker__trigger'});
  const menu = h('details', {class:'people-picker__menu'}, toggle, h('div', {class:'people-picker__popup'}, search, results, count));
  let matches = [];
  function personLabel(person) {
    return [h('span', {class:'people-picker__name',text:person.name}), person.studentId ? h('span', {class:'people-picker__id',text:person.studentId}) : null];
  }
  function choose(id) {
    values.add(id); search.value=''; draw(); search.focus(); onChange([...values]);
  }
  function drawResults() {
    const query=search.value.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    matches=people.filter(person=>!values.has(person.id)&&query.every(part=>`${person.name} ${person.studentId||''}`.normalize('NFKC').toLocaleLowerCase().includes(part)));
    results.replaceChildren(...matches.map(person=>h('button',{type:'button',class:'people-picker__option',on:{click:()=>choose(person.id)},aria:{label:`添加${person.name}${person.studentId?` ${person.studentId}`:''}`}},...personLabel(person))));
    count.textContent=matches.length?`${matches.length} 位可选；回车添加首个结果`:'没有匹配的人员';
  }
  function draw() {
    toggle.textContent=values.size?`添加${label} · 已选 ${values.size} 人`:`选择${label}`;
    tokens.replaceChildren(...[...values].map(id=>{
      const person=people.find(item=>item.id===id)||{id,name:'已选人员（目录暂不可用）'};
      return h('span',{class:`people-picker__token${fixed.has(id)?' is-fixed':''}`},...personLabel(person),fixed.has(id)?null:h('button',{type:'button',class:'people-picker__remove',text:'×',aria:{label:`移除${person.name}`},on:{click:()=>{values.delete(id);draw();toggle.focus();onChange([...values]);}}}));
    }));
    drawResults();
  }
  search.addEventListener('input',drawResults);
  search.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Enter'){event.preventDefault();if(matches[0])choose(matches[0].id);}
    if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}
  });
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();event.stopPropagation();menu.open=false;toggle.focus();}});
  menu.addEventListener('toggle',()=>{if(menu.open)search.focus();});
  root.append(tokens,menu);draw();
  return {node:root, value:()=>[...values], setPeople:next=>{people=next;draw();},setSelected:next=>{values.clear();[...fixed,...next].forEach(id=>values.add(id));draw();}};
}
