import {h} from '../core/dom.js';
import {getSessionState} from '../core/api.js';
import {button} from '../ui/primitives.js';

/** Display preferences are local to the current account/activity; never alter data or permissions. */
export function rosterColumns({columns,key}){
 const actor=getSessionState().user?.accountId||getSessionState().user?.username||'local';
 const storageKey='roster-columns:v1:'+actor+':'+key;let hidden=new Set(),table=null;
 try{const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))hidden=new Set(saved.filter(name=>columns.includes(name)));}catch{/* Storage is optional. */}
 if(hidden.size>=columns.length)hidden.clear();
 const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify([...hidden]));}catch{/* Session-only preferences remain usable. */}};
 function apply(next=table){table=next;if(!table)return;const present=columns.filter(name=>table.querySelector('thead [data-roster-column="'+name+'"]'));if(present.length&&present.every(name=>hidden.has(name))){hidden.delete(present[0]);save();for(const input of choices.querySelectorAll('input'))if(input.parentElement.textContent===present[0])input.checked=true;}for(const cell of table.querySelectorAll('[data-roster-column]'))cell.hidden=hidden.has(cell.dataset.rosterColumn);for(const cell of table.querySelectorAll('[data-roster-group]'))cell.colSpan=Math.max(1,columns.filter(name=>!hidden.has(name)&&table.querySelector('thead [data-roster-column="'+name+'"]')).length);}
 const choices=h('div',{class:'roster-column-picker__options'},...columns.map(name=>h('label',{},h('input',{type:'checkbox',checked:!hidden.has(name),on:{change:e=>{if(!e.target.checked&&(table?columns.filter(name=>table.querySelector('thead [data-roster-column="'+name+'"]')).every(value=>value===name||hidden.has(value)):hidden.size===columns.length-1)){e.target.checked=true;return;}if(e.target.checked)hidden.delete(name);else hidden.add(name);save();apply();}}}),h('span',{text:name}))));
 const control=h('details',{class:'roster-column-picker'},h('summary',{class:'btn btn--secondary',text:'显示栏目'}),h('div',{class:'roster-column-picker__menu'},choices,h('p',{class:'t-caption',text:'至少保留一栏；仅调整当前账号的显示。'}),button({label:'恢复默认栏目',variant:'ghost',size:'sm',onClick:()=>{hidden.clear();for(const input of choices.querySelectorAll('input'))input.checked=true;save();apply();}})));
 return {control,apply,cell:(name,node)=>{node.dataset.rosterColumn=name;return node;}};
}
