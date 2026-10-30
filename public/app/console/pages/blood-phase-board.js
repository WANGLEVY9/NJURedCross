import {bloodAttendanceMark} from './blood-attendance-mark.js';
import {h} from '../../core/dom.js';
import {button} from '../../ui/primitives.js';
import {openDrawer} from '../../ui/overlay.js';
import {BLOOD_POINTS} from '../../shared/blood-points.js';

/** Reuses scoped service records and their existing review actions. */
export function bloodPhaseBoard({events,rows,selected,onSelect,onOpen,label,enabled,phase,toolsHost,batchMode=false,onBatchMode}){
 const root=h('section',{class:'blood-registration-board', 'aria-label':phase+'排班看板'}),scroll=h('div',{class:'blood-registration-board__grid'}),grid=h('div',{class:'blood-card-grid'+(batchMode?' is-selecting':'')});
 const dates=events.map(e=>e['报名日期']).filter(Boolean).sort();if(!dates.length)return root;
 const start=new Date(dates[0]+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
 if(batchMode)grid.append(h('header',{class:'blood-row-select',text:'选择岗位'}));
 days.forEach((day,i)=>{const ids=new Set(events.filter(e=>e['报名日期']===day).map(e=>e['活动ID'])),list=rows.filter(r=>ids.has(r.activityId)&&enabled(r));grid.append(h('header',{class:'blood-card-grid__heading'},h('strong',{text:['周一','周二','周三','周四','周五','周六','周日'][i]}),h('small',{text:day}),batchMode?h('input',{type:'checkbox',disabled:!list.length,checked:!!list.length&&list.every(r=>selected.has(r.id)),'aria-label':'全选 '+day,on:{change:e=>{for(const r of list)onSelect(r.id,e.target.checked);}}}):null));});
 function person(row){const check=batchMode&&enabled(row)?h('input',{type:'checkbox',checked:selected.has(row.id),'aria-label':'选择 '+row.name,on:{click:e=>e.stopPropagation(),keydown:e=>e.stopPropagation(),change:e=>onSelect(row.id,e.target.checked)}}):null;return h('div',{},check,h('span',{text:row.name+' '+row.studentId}),bloodAttendanceMark(row.registration));}
 const points=[BLOOD_POINTS[1],BLOOD_POINTS[0],BLOOD_POINTS[3],BLOOD_POINTS[2]],names=['印象汇','中央','弘阳广场','学则路'];
 for(const [i,point] of points.entries())for(const period of ['上午','下午'])for(const day of days){
   if(point===BLOOD_POINTS[2]&&period==='上午')continue;
  if(batchMode&&day===days[0]){const ids=new Set(events.filter(e=>e['地点']===point&&String(e['报名时段']).startsWith(period)).map(e=>e['活动ID'])),list=rows.filter(r=>ids.has(r.activityId)&&enabled(r));grid.append(h('label',{class:'blood-row-select'},h('input',{type:'checkbox',disabled:!list.length,checked:!!list.length&&list.every(r=>selected.has(r.id)),'aria-label':'全选 '+names[i]+'·'+period,on:{change:e=>{for(const r of list)onSelect(r.id,e.target.checked);}}})));}
  const event=events.find(e=>e['地点']===point&&e['报名日期']===day&&String(e['报名时段']).startsWith(period));
  const records=event?rows.filter(r=>r.activityId===event['活动ID']):[];
  const status=!event?'未排班':records.length?records.some(enabled)?'待审核':label(records[0]):'暂无记录';
  const tone=status==='待审核'?'review':/通过|入账|录入|已签到/.test(status)?'success':'ended';
  const open=()=>{let drawer;drawer=openDrawer({title:phase+' · 班次详情',body:h('div',{class:'stack-4'},h('p',{text:day+' '+point+' '+(event?.['报名时段']||'未排班')}),...records.map(row=>h('section',{class:'stack-2'},person(row),h('strong',{text:label(row)}),button({label:'查看与处理',onClick:async()=>{await drawer.close();onOpen(row);}}))),!records.length?h('p',{text:'本班次暂无符合条件的记录'}):null)});};
  grid.append(h('article',{class:'blood-schedule-card'+(!event?' is-unplanned':''),role:'button',tabindex:0,'aria-label':day+' '+names[i]+' '+phase,on:{click:open,keydown:e=>{if(e.target===e.currentTarget&&['Enter',' '].includes(e.key)){e.preventDefault();open();}}}},h('div',{class:'blood-schedule-card__title'},h('span',{class:'blood-schedule-status blood-schedule-status--'+tone,text:status}),h('strong',{text:names[i]+'·'+period})),h('div',{class:'blood-schedule-card__people'},...records.slice(0,2).map(person),!records.length?h('span',{class:'t-muted',text:'—'}):null,records.length>2?h('small',{text:'点击查看全部 '+records.length+' 条记录'}):null)));
 }
 if(toolsHost)toolsHost.replaceChildren(button({label:batchMode?'退出批量操作':'批量操作',onClick:()=>onBatchMode?.(!batchMode)}));
 scroll.append(grid);root.append(scroll);return root;
}
