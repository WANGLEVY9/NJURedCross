import {createHmac,timingSafeEqual} from 'node:crypto';
const payload = row => JSON.stringify(['blood-attendance-v1',row['报名行ID'],row['活动ID'],row['账号ID'],row['学号'],row['核验人'],row['核验说明'],row['活动时间']]);
export function signBloodAttendance(row,secret) {
 return 'WCM-'+createHmac('sha256',secret).update(payload(row)).digest('hex');
}
export function verifiedBloodAttendance(registration,checkin,secret) {
 if(!checkin||checkin['报名行ID']!==registration._id||!checkin['核验人']||!checkin['核验说明']||!checkin['活动时间'])return false;
 const actual=Buffer.from(String(checkin['签到ID']||'')),expected=Buffer.from(signBloodAttendance(checkin,secret));
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
