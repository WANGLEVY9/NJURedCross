import test from 'node:test';
import assert from 'node:assert/strict';
import {eventRegistrations} from '../public/app/portal/event-registrations.js';

const event={eventId:'autumn',name:'秋季急救员活动',startAt:'2026-10-12T14:00:00+08:00',sessions:[{startAt:'2026-10-13T14:00:00+08:00'}]};
test('legacy own records match the exact activity or session time',()=>{
 const records=[
  {code:'current',eventName:event.name,startAt:event.startAt},
  {code:'session',eventName:event.name,startAt:'2026-10-13T06:00:00Z'},
  {code:'old',eventName:event.name,startAt:'2025-10-12T14:00:00+08:00'},
  {code:'foreign',eventId:'other',eventName:event.name,startAt:event.startAt},
  {code:'unknown',eventName:event.name},
 ];
 assert.deepEqual(eventRegistrations(records,event).map(record=>record.code),['current','session']);
});
test('current responses use IDs even if a title or time was edited',()=>{
 assert.equal(eventRegistrations([{eventId:'autumn',eventName:'旧名称'}],event).length,1);
});
