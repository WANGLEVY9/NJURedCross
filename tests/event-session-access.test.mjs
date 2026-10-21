import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEventSessionAccess} from '../lib/events/event-session-access.js';
import {visibleConsoleSections} from '../public/app/console/navigation.js';
const payload=(permissions=[])=>({user:{permissions,consoleAccess:true,surfaces:['console']}});
const hasEvents=result=>visibleConsoleSections(scope=>result.user.permissions.includes(scope)).some(item=>item.path==='/console/events');
test('activity module navigation survives authority outages and unconfigured scoped roles',()=>{
 for(const [access,options] of [[undefined,{unavailable:true}],[{canEnter:false},{}]]){
  const result=projectEventSessionAccess(payload(['events','outreach']),access,options);
  assert.equal(hasEvents(result),true);assert.deepEqual(result.user.permissions,['events','outreach']);
  assert.equal(result.user.eventAuthorityUnavailable,options.unavailable);
 }
});
test('unavailable evidence never grants activity access to unrelated accounts',()=>{
 const result=projectEventSessionAccess(payload(['outreach']),undefined,{unavailable:true});
 assert.equal(hasEvents(result),true);assert.equal(result.user.permissions.includes('events'),false);assert.deepEqual(result.user.permissions,['outreach']);
});
test('fresh scoped authority can add the activity module without duplicate grants',()=>{
 const result=projectEventSessionAccess(payload(),{canEnter:true});projectEventSessionAccess(result,{canEnter:true});
 assert.equal(hasEvents(result),true);assert.deepEqual(result.user.permissions,['events']);assert.deepEqual(result.user.surfaces,['console']);
});
