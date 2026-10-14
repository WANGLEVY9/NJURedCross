import {h,icon} from '../core/dom.js';
import {panel,badge,definitionList} from '../ui/primitives.js';
import {eventCenterLabel} from './event-center.js';

export function participationGuide({blood=false}={}) {
 return h('section',{class:'participation-notice','aria-label':'参与须知'},
  h('h3',{},icon('calendar'),h('span',{text:'报名前，请了解这些安排'})),
  h('ol',{},
   h('li',{},h('b',{text:blood?'核对班次':'核对安排'}),h('p',{text:blood?'请确认服务地点与时间，避免与已报名的班次重叠。':'请确认服务地点与时间，避免与已报名的活动重叠。'})),
   h('li',{},h('b',{text:'查看报名结果'}),h('p',{text:'报名后等待负责人确认；待确认时可直接取消，确认后无法参加请申请请假。献血车浦口弘阳广场报名后直接成功。'})),
   h('li',{},h('b',{text:'现场签到'}),h('p',{text:blood?'报名成功后，请按时到场，并在活动时段内上传带有日期和时间的现场照片。':'请按时到场，并按活动要求出示签到凭证或提交现场照片。'}))));
}

export function activityRegistrationDetail({event,facts,participant={},authenticated=false,signup,feedback=null,extra=null,identity=null}) {
 const result=panel({title:event.name,body:h('div',{class:'stack-4'},
  facts.classList?.contains('workflow-slot-summary')?facts:h('section',{class:'workflow-slot-summary','aria-label':'确认活动安排'},facts),
  h('div',{class:'blood-detail-grid'},
   h('section',{class:'blood-detail-information'},h('h3',{class:'blood-section-label',text:'参与安排'}),
    event.work&&!/^按所选.*参与.*服务[。.]?$/.test(event.work.trim())?h('p',{class:'t-secondary workflow-copy',text:event.work}):null,
    extra,participationGuide({blood:Boolean(event.blood)})),
   h('section',{class:'blood-detail-personal'},h('h3',{class:'blood-section-label',text:'我的报名信息'}),
    authenticated?h('p',{class:'identity-source',text:'以下资料来自你的账号，仅用于本次报名。'}):null,
    authenticated?(identity||definitionList([['姓名',participant.realName||'暂未获取'],['学号',participant.studentId||'—'],['邮箱',participant.email||'暂未获取'],['所属校区',participant.campus||'待完善'],['院系',participant.department||'—'],['年级',participant.grade||'—']])):h('p',{class:'t-secondary',text:'登录后自动使用账号中的姓名与邮箱。'}),
    h('div',{class:'blood-detail-submit'},signup,feedback))))});
 result.classList.add('workflow-event-detail');
 result.querySelector('.section-head__text').prepend(badge(eventCenterLabel(event),{tone:'accent'}));
 return result;
}
