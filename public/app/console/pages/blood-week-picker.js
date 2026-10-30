import {h} from '../../core/dom.js';
import {button} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';

export function bloodWeekPicker({options,current,onChange}){
 const monday=value=>{const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
 const weeks=options.map(o=>({...o,start:monday([...o.dates].sort()[0]||o.date)}));
 const end=start=>{const d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+6);return d.toISOString().slice(0,10);};
 const selected=weeks.find(o=>o.id===current)||weeks[0];if(!selected)return h('div');
 const trigger=button({label:'▦ '+selected.start.slice(5)+' ～ '+end(selected.start).slice(5)+' ▾',onClick:()=>{
  let month=selected.start.slice(0,7),modal;
  const calendar=h('div',{class:'blood-week-calendar'}),heading=h('strong'),body=h('div');
  const move=delta=>{const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);month=d.toISOString().slice(0,7);render();};
  calendar.append(h('div',{class:'row-between'},button({label:'上个月',onClick:()=>move(-1)}),heading,button({label:'下个月',onClick:()=>move(1)})),body);
  function render(){heading.textContent=month.replace('-','年')+'月';body.replaceChildren(h('div',{class:'blood-week-calendar__row'},...['一','二','三','四','五','六','日'].map(text=>h('span',{text}))));
   const first=new Date(monday(month+'-01')+'T00:00:00Z');
   for(let i=0;i<6;i++){const date=new Date(first);date.setUTCDate(date.getUTCDate()+i*7);const start=date.toISOString().slice(0,10),option=weeks.find(w=>w.start===start);
    const row=h('button',{type:'button',class:'blood-week-calendar__row'+(start===selected.start?' is-selected':''),disabled:!option,'aria-label':start+' 至 '+end(start),'aria-pressed':String(start===selected.start),on:{click:async()=>{await modal.close();onChange(option.id);}}},...Array.from({length:7},(_,j)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+j);return h('span',{class:d.toISOString().slice(0,7)===month?'':'t-muted',text:String(d.getUTCDate())});}));body.append(row);
   }
  }
  render();modal=openModal({title:'选择排班周（整周选择）',body:calendar});
 }});trigger.setAttribute('aria-label','选择排班周');return h('div',{class:'blood-week-picker'},trigger);
}
