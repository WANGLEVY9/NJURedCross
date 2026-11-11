import {h} from '../../core/dom.js';
import {field,button,panel} from '../../ui/primitives.js';
import {validServiceDate} from '../../shared/special-activity.js';

/** Edits business configuration only; persistence and current authority belong to the host. */
export function specialScheduleEditor({content,onChange}){
 const special=content.special,root=h('div',{class:'stack-3'}),calendar=h('div',{class:'special-date-picker'}),places=h('div',{class:'stack-3'});
 const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 let month=(special.dates[0]||content.date||day).slice(0,7);
 if(!/^\d{4}-\d{2}$/.test(month))month=day.slice(0,7);
 function input(key,label,type='text',extra={}){
  const f=field({name:key,label,type,value:content[key]||'',...extra,onInput:()=>{content[key]=f.control.value;if(key==='date'&&validServiceDate(content.date))month=content.date.slice(0,7);renderDates();onChange();}});return f;
 }
 const cutoff=field({label:'报名提前截止（分钟）',name:'cutoffMinutes',type:'number',value:Math.max(1440,Number(special.cutoffMinutes)||0),min:1440,max:43200,step:1,hint:'默认提前24小时（1440分钟）截止，仅影响报名，不关闭签到凭证上传。',onInput:()=>{special.cutoffMinutes=cutoff.control.value;onChange();}});
 function renderDates(){
  const selected=new Set(special.dates),first=new Date(month+'-01T00:00:00Z'),offset=(first.getUTCDay()+6)%7,last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const move=delta=>{const d=new Date(first);d.setUTCMonth(d.getUTCMonth()+delta);month=d.toISOString().slice(0,7);renderDates();};
  const choose=field({label:'排班月份',type:'month',value:month,onInput:()=>{if(/^\d{4}-\d{2}$/.test(choose.control.value)){month=choose.control.value;renderDates();}}});
  const grid=h('div',{class:'special-date-picker__grid',role:'group','aria-label':'选择服务日期'},...['一','二','三','四','五','六','日'].map(text=>h('span',{'aria-hidden':'true',text})));
  for(let i=0;i<offset;i++)grid.append(h('span'));
  for(let n=1;n<=last;n++){
   const date=`${month}-${String(n).padStart(2,'0')}`,outside=!validServiceDate(content.date)||!validServiceDate(content.endDate)||date<content.date||date>content.endDate;
   grid.append(h('button',{type:'button',class:'special-date-picker__day'+(selected.has(date)?' is-selected':''),disabled:outside,'aria-label':date,'aria-pressed':String(selected.has(date)),text:String(n),on:{click:()=>{if(selected.has(date))selected.delete(date);else selected.add(date);special.dates=[...selected].sort();renderDates();onChange();}}}));
  }
  const out=special.dates.filter(date=>date<content.date||date>content.endDate);
  calendar.replaceChildren(h('div',{class:'row-2'},button({label:'上月',onClick:()=>move(-1)}),choose,button({label:'下月',onClick:()=>move(1)})),grid,h('p',{class:'t-caption',text:`已选 ${special.dates.length} 天${out.length?` · ${out.length}天已超出日期范围，请调整或取消`:''}`}),h('div',{class:'row-2 row-wrap'},...special.dates.map(date=>button({label:date+' ×',size:'sm',variant:'ghost',onClick:()=>{special.dates=special.dates.filter(value=>value!==date);renderDates();onChange();}}))));
 }
 function renderPlaces(){
  places.replaceChildren(...special.places.map((place,index)=>{
   const location=field({label:'岗位',name:`schedule-location-${index}`,value:place.location,maxlength:120,onInput:()=>{place.location=location.control.value;onChange();}});
   const periods=h('div',{class:'stack-2'},...place.periods.map((period,i)=>{
    const fields=h('div',{class:'activity-draft-grid'});
    for(const [key,label,type]of [['start','开始时间','time'],['end','结束时间','time'],['capacity','每班名额','number'],['serviceHours','服务时长','number'],['trainingHours','培训时长','number'],['travelHours','交通时长','number']]){
     const control=field({label,type,name:`schedule-${index}-${i}-${key}`,value:period[key]??'',step:type==='time'?60:key==='capacity'?1:0.1,min:key==='capacity'?1:0,onInput:()=>{period[key]=control.control.value;onChange();}});fields.append(control);
    }
    return h('section',{class:'special-period stack-2'},fields,button({label:'移除此时段',variant:'ghost',size:'sm',onClick:()=>{place.periods.splice(i,1);renderPlaces();onChange();}}));
   }));
   return panel({title:`服务岗位 ${index+1}`,actions:[button({label:'移除岗位',size:'sm',variant:'ghost',onClick:()=>{special.places.splice(index,1);renderPlaces();onChange();}})],body:h('div',{class:'stack-3'},location,periods,button({label:'添加时段',size:'sm',onClick:()=>{place.periods.push({start:'13:00',end:'17:00',capacity:'3',serviceHours:'4',trainingHours:'0',travelHours:'0'});renderPlaces();onChange();}}))});
  }));
 }
 root.append(panel({title:'服务日期',body:h('div',{class:'stack-3'},h('div',{class:'activity-draft-grid'},input('date','开始日期','date'),input('endDate','结束日期','date'),cutoff),calendar)}),places,button({label:'添加服务岗位',onClick:()=>{special.places.push({location:'',periods:[{start:'08:00',end:'12:00',capacity:'3',serviceHours:'4',trainingHours:'0',travelHours:'0'}]});renderPlaces();onChange();}}),input('work','工作内容','text',{multiline:true,rows:3,maxlength:500}));
 renderDates();renderPlaces();return root;
}
