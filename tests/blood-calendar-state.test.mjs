import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app/portal/blood-calendar.js',import.meta.url),'utf8');
const scope={};vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('export const CALENDAR_STATES'),source.indexOf('export function bloodCalendar')).replaceAll('export ','')+';this.states=CALENDAR_STATES;',scope);
test('calendar states follow the registration lifecycle and match legend text',()=>{
 const event={remaining:0};
 for(const [own,state,label] of [
  [{status:'待筛选'},'pending','待确认'],
  [{status:'已确认'},'confirmed','报名成功'],
  [{status:'已签到',result:'报名成功'},'confirmed','报名成功'],
  [{status:'已确认',leaveStatus:'待审批'},'confirmed','报名成功'],
  [{status:'已请假'},'leave','已请假'],
  [{status:'未入选'},'rejected','报名失败'],
  [{status:'已取消',leaveStatus:'待审批'},'full','已满'],
 ]){const value=scope.slotState(event,own);assert.equal(value.state,state);assert.equal(value.label,label);assert.equal(value.label,scope.states[state].label);}
 assert.equal(scope.slotState({remaining:'0'},null).state,'full');
 assert.equal(scope.slotState({remaining:1},null).state,'open');
 assert.equal(scope.slotState({remaining:1},{status:'已取消',result:'已取消'}).state,'open');
 assert.equal(scope.slotState({remaining:1},{status:'待筛选',leaveStatus:'待审批'}).state,'pending');
 assert.deepEqual(Object.keys(scope.states),['open','full','pending','confirmed','leave','rejected']);
});
test('new active signup outranks historical attempts without mutating records',()=>{
 const cancelled={eventId:'a',status:'已取消',submittedAt:'2026-10-10'};
 const active={eventId:'a',status:'待筛选',submittedAt:'2026-10-09'};
 const rows=[cancelled,active,{eventId:'b',status:'已签到'}];
 assert.equal(scope.ownRegistration(rows,'a'),active);
 assert.equal(rows[0],cancelled);
 assert.equal(scope.ownRegistration(rows,'missing'),null);
});