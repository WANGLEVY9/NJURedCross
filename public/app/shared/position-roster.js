import {h,icon} from '../core/dom.js';
import {request} from '../core/api.js';
import {asyncRegion} from '../console/lib.js';
import {badge,button,definitionList,emptyState} from '../ui/primitives.js';

/** Private data stays in this lazy, authenticated region, never in public activity projections. */
export function positionRoster(eventId) {
  const region=asyncRegion({
    lazy:true,
    errorTitle:'报名名单暂时无法加载',
    load:()=>request(`/api/volunteer/workflow/events/${encodeURIComponent(eventId)}/positions`),
    render:payload=>h('div',{class:'stack-4'},
      h('div',{class:'row-between'},h('span',{class:'t-caption',text:`共 ${payload.positions.length} 个名额`}),
        button({label:'刷新名单',iconName:'refresh',variant:'ghost',size:'sm',onClick:()=>region.reload()})),
      payload.positions.length?h('div',{class:'position-roster__list'},...payload.positions.map(p=>{
        const fields=Object.entries(p.profile||{}).filter(([,value])=>value);
        return h('article',{class:'position-roster__person stack-3'},
          h('div',{class:'row-between row-wrap'},h('b',{text:`名额 ${p.position}`}),badge(p.status,{tone:p.status==='可报名'?'neutral':'accent'})),
          fields.length?definitionList(fields):h('p',{class:'t-caption',text:p.status==='可报名'?'暂无报名志愿者':'报名资料尚未同步'}));
      })):emptyState({title:'暂无名额信息'}))
  });
  const details=h('details',{class:'participation-action position-roster',on:{toggle:()=>{if(details.open)region.ensureLoaded();}}},
    h('summary',{},h('span',{class:'participation-action__icon'},icon('users')),
      h('span',{class:'participation-action__label'},h('b',{text:'查看报名志愿者'}),h('span',{text:'查看各名额的报名状态与志愿者资料'})),icon('chevronDown','ico participation-action__chevron')),
    h('div',{class:'participation-action__body'},region));
  return details;
}
