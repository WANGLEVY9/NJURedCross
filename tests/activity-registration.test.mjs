import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationCapacity} from '../public/app/shared/activity-registration.js';
test('full registration includes pending and source bookings but does not advance the phase',()=>{
 const event={活动ID:'a',状态:'报名中',容量:3,报名页配置:JSON.stringify({sourceActivityIds:['source'],sourceOccupied:1})};
 const rows=[{活动ID:'a',报名状态:'待筛选'},{活动ID:'source',报名状态:'已确认'},{活动ID:'other',报名状态:'已确认'},{活动ID:'a',报名状态:'未入选'}];
 assert.deepEqual(registrationCapacity(event,rows),{capacity:3,occupied:3,full:true});assert.equal(event['状态'],'报名中');
 rows[0]['报名状态']='未入选';assert.equal(registrationCapacity(event,rows).full,false);
 assert.equal(registrationCapacity({...event,状态:'进行中'},rows).full,false);
 assert.equal(registrationCapacity({...event,容量:0},rows).full,false);
});
