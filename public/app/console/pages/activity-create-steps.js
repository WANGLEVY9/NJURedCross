import {h} from '../../core/dom.js';

export function activityCreateSteps(current){
 return h('ol',{class:'activity-create-steps','aria-label':'创建活动步骤'},...['活动信息','岗位安排','通知与审批'].map((label,index)=>h('li',{class:index+1===current?'is-current':index+1<current?'is-done':'',...(index+1===current?{'aria-current':'step'}:{}),text:`${index+1}. ${label}`})));
}
