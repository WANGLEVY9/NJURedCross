import test from 'node:test';
import assert from 'node:assert/strict';
import {eventSignupState} from '../public/app/portal/event-signup.js';
test('registered users see a disabled action even when their signup fills the event',()=>{
 const event={eventId:'first-aid',capacity:1,remaining:0,full:true};
 for(const status of ['待筛选','待确认','已确认','已签到','候补'])assert.deepEqual(eventSignupState(event,[{eventId:'first-aid',status}]),{label:'已报名',disabled:true});
});
test('full ordinary activities and workflow shifts cannot open signup',()=>{
 for(const event of [{eventId:'duty',full:true},{id:'shift',capacity:3,remaining:0},{id:'shift',capacity:3,remaining:'0'}])assert.deepEqual(eventSignupState(event),{label:'已报满',disabled:true});
});
test('cancelled, rejected and other-event records do not prevent a fresh signup',()=>{
 const event={eventId:'first-aid',capacity:2,remaining:1};
 const records=[{eventId:'first-aid',status:'已取消'},{eventId:'first-aid',status:'未入选'},{eventId:'other',status:'已确认'}];
 assert.deepEqual(eventSignupState(event,records),{label:'我要报名',disabled:false});
 assert.deepEqual(eventSignupState({...event,remaining:0},records),{label:'已报满',disabled:true});
 assert.equal(eventSignupState({eventId:'unlimited',capacity:0,remaining:0,full:false}).disabled,false);
});