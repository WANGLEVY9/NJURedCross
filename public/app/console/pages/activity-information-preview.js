import {h} from '../../core/dom.js';
import {definitionList} from '../../ui/primitives.js';
export function activityInformationPreview(content){
  const d=content.content;
  return h('div',{class:'stack-4'},definitionList([['活动名称',d.name],['地区',d.region==='suzhou'?'苏州地区':'南京地区'],['类别',d.category],['活动负责人',content.responsibleName||d.responsibleId],['活动说明',d.description],['日期',`${d.date} — ${d.endDate}`],['报名截止',d.deadline],['岗位数量',d.bookingMode==='grouped'?'多岗位':'单岗位']]),d.bookingMode==='grouped'?h('div',{class:'activity-draft-table'},h('table',{},h('thead',{},h('tr',{},...['岗位','日期','开始','结束','校区','地点','人数','服务时长','培训时长','交通时长','工作内容'].map(text=>h('th',{text})))),h('tbody',{},...d.positions.map(p=>h('tr',{},...['name','date','start','end','campus','location','capacity','serviceHours','trainingHours','travelHours','work'].map(key=>h('td',{text:p[key]}))))))):definitionList([['时间',`${d.start} — ${d.end}`],['地点',d.location],['人数',d.capacity],['服务／培训／交通时长',`${d.serviceHours} / ${d.trainingHours||0} / ${d.travelHours||0}`],['工作内容',d.work]]),h('section',{},h('h3',{text:'报名通知'}),h('p',{class:'activity-approval-notice',text:d.notice})));
 }
