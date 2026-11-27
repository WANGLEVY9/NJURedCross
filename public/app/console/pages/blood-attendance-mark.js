import {h} from '../../core/dom.js';

export const hasBloodCheckin = row => row?.['报名状态'] === '已签到';

export function bloodAttendanceMark(row) {
 if (hasBloodCheckin(row) || row?.['签到行ID']) return h('img',{class:'blood-checkin-stamp',src:'/assets/nju-red-cross-stamp-128.webp',alt:'已签到',width:64,height:64,decoding:'async'});
 if (row?.['签到照片ID']) return h('small',{class:'blood-checkin-photo',text:'待核验'});
 return h('small',{class:'blood-checkin-pending',text:'未签到'});
}
