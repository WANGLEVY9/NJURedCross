import {h} from '../../core/dom.js';
import {badge} from '../../ui/primitives.js';
import {positionLabel} from '../../shared/position-labels.js';
import {workspaceResponsibleIds} from '../../shared/activity-workspace.js';

/** A saved snapshot in the original activity-paper style, never a live editor. */
export function activityInformationPreview({content:d,responsibleName}){
  const value=text=>text||'未填写';
  const schedule=entries=>h('dl',{class:'activity-preview__schedule'},...entries.flatMap(([label,text])=>[h('dt',{text:label}),h('dd',{text:value(text)})]));
  const hours=p=>h('div',{class:'activity-preview__metrics'},...[[p.capacity,'招募人数 / 人'],[p.serviceHours,'服务时长 / 小时'],[p.trainingHours||'0','培训时长 / 小时'],[p.travelHours||'0','交通时长 / 小时']].map(([text,label])=>h('div',{},h('strong',{text:value(text)}),h('span',{text:label}))));
  const position=(p,index)=>h('section',{class:'activity-preview-position'},h('h3',{text:d.bookingMode==='grouped'?`${positionLabel(index+1)} · ${value(p.name)}`:'活动安排'}),schedule([['日期',d.bookingMode==='grouped'?p.date:d.date===d.endDate?d.date:`${d.date} - ${d.endDate}`],['时间',`${value(p.start)}-${value(p.end)}`],['地点',p.location]]),h('div',{class:'activity-preview__work'},h('strong',{text:'工作内容'}),h('p',{text:value(p.work)})),hours(p));
  return h('article',{class:'activity-preview__paper activity-information-paper'},
    h('div',{class:'activity-preview__meta'},badge(d.category||'待选类别',{tone:'accent'}),h('span',{text:d.region==='suzhou'?'苏州地区':'南京地区'})),
    h('h2',{class:'activity-preview__title',text:d.name}),
    h('p',{class:'activity-preview__mode',text:d.bookingMode==='grouped'?'按岗位分别报名':d.bookingMode==='unified'?'整体活动统一报名':'岗位数量待选择'}),
    d.description?h('p',{class:'activity-preview__description',text:d.description}):null,
    schedule([['日期',d.date===d.endDate?d.date:`${value(d.date)} - ${value(d.endDate)}`],['截止',d.deadline?.replace('T',' ')]]),
    h('div',{class:'activity-preview__people'},h('strong',{text:'活动负责人'}),h('div',{},h('span',{text:responsibleName||workspaceResponsibleIds(d).join('、')||'未选择'}))),
    ...(d.bookingMode==='grouped'?d.positions.map(position):d.bookingMode==='unified'?[position(d,0)]:[]),
    h('section',{class:'activity-preview-notice'},h('h3',{text:'报名通知'}),h('p',{class:'activity-approval-notice',text:d.notice||'未填写'})));
}
