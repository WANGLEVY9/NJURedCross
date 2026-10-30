import {h} from '../../core/dom.js';

export const hasBloodCheckin = row => row?.['报名状态'] === '已签到';

export function bloodAttendanceMark(row) {
 return hasBloodCheckin(row)
  ? h('img',{class:'blood-checkin-stamp',src:'/assets/nju-red-cross-stamp-128.webp',alt:'已签到',width:64,height:64,decoding:'async'})
  : h('small',{class:'blood-checkin-pending',text:'未签到'});
}
