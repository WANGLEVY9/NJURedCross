import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPositionLabels, positionLabel } from '../public/app/shared/position-labels.js';
import { matchesServiceContext, attendanceBlockReason, serviceSession } from '../public/app/console/pages/activity-service-state.js';

const positions = [
  { name: '引导', campus: '苏州', location: '苏州门口', start: '2030-10-15T09:00:00+08:00', end: '2030-10-15T12:00:00+08:00' },
  { name: '引导', campus: '仙林', location: '仙林门口', start: '2030-10-14T09:00:00+08:00', end: '2030-10-14T12:00:00+08:00' },
  { name: '后勤', campus: '鼓楼', location: '鼓楼大厅', start: '2030-10-16T09:00:00+08:00', end: '2030-10-16T12:00:00+08:00' },
];
const child = (id, position) => ({ 活动ID: id, 岗位: position.name, 地点: position.location,
  报名日期: position.start.slice(0, 10), 报名时段: '09:00:00-12:00:00',
  报名页配置: JSON.stringify({ parentActivityId: 'parent', ordinary: { ...position } }) });
const children = [child('b', positions[0]), child('a', positions[1]), child('c', positions[2])];
const parent = { 活动ID: 'parent', 报名页配置: JSON.stringify({ positionPlan: { positions, eventIds: ['b', 'a', 'c'] } }) };

test('saved event order numbers duplicate names across campuses independently of registration order', () => {
  const registrations = [{ 活动ID: 'a', 岗位: '引导' }, { 活动ID: 'b', 岗位: '引导' }];
  for (const rows of [registrations, registrations.toReversed(), registrations.slice(0, 1)]) {
    const labels = createPositionLabels({ event: children[1], events: [children[2], parent, children[1], children[0]], registrations: rows });
    assert.deepEqual(labels.entries.map(entry => entry.eventId), ['b', 'a', 'c']);
    assert.equal(labels.labelFor(registrations[0]), '岗位二');
    assert.equal(labels.labelFor(registrations[1]), '岗位一');
    assert.equal(labels.labelFor(children[2]), '岗位三');
    assert.match(labels.legend, /岗位一：引导（苏州校区 · 苏州门口）/);
    assert.equal(labels.entryFor(registrations[0]).campus, '仙林');
  }
});

test('saved missing child does not renumber existing positions', () => {
  const labels = createPositionLabels({ event: parent, events: [children[1]], registrations: [] });
  assert.equal(labels.entries.length, 3);
  assert.equal(labels.labelFor({ 活动ID: 'a' }), '岗位二');
  assert.equal(labels.labelFor({ 活动ID: 'c', 岗位: '后勤' }), '岗位三');
});

test('draft positions match child configuration before fallback and retain saved order', () => {
  const draft = { ...parent, 报名页配置: { positionDraft: { positions } } };
  const labels = createPositionLabels({ event: draft, events: children.toReversed() });
  assert.deepEqual(labels.entries.map(entry => entry.eventId), ['b', 'a', 'c']);
  assert.equal(labels.labelFor({ 活动ID: 'a', 岗位: '引导' }), '岗位二');
});

test('eventIds-only configuration and legacy children remain deterministic', () => {
  const event = { ...parent, 报名页配置: JSON.stringify({ positionPlan: { eventIds: ['b', 'a'] } }) };
  assert.deepEqual(createPositionLabels({ event, events: children.slice(0, 2) }).entries.map(entry => entry.eventId), ['b', 'a']);
  const old = createPositionLabels({ event: children[2], events: children.toReversed() });
  assert.deepEqual(old.entries.map(entry => entry.eventId), ['a', 'b', 'c']);
});

test('legacy registration-only labels ignore arrival order and invalid configuration', () => {
  const registrations = [{ 岗位: '后勤' }, { 岗位: '引导' }, { 岗位: '后勤' }];
  const event = { 报名页配置: '{invalid' };
  const one = createPositionLabels({ event, registrations });
  const two = createPositionLabels({ event, registrations: registrations.toReversed() });
  assert.equal(one.legend, two.legend);
  assert.equal(one.entries.length, 2);
  assert.equal(one.labelFor({}), '不限岗位');
  assert.equal(createPositionLabels().legend, '');
});

test('Chinese ordinal labels support the configured 200-position maximum', () => {
  assert.deepEqual([1, 9, 10, 11, 20, 99, 100, 101, 110, 200].map(positionLabel),
    ['岗位一', '岗位九', '岗位十', '岗位十一', '岗位二十', '岗位九十九', '岗位一百', '岗位一百零一', '岗位一百一十', '岗位二百']);
  assert.equal(positionLabel(0), '');
});

test('attendance defaults to confirmed or checked-in while pending and all remain explicit and blocked', () => {
  const context = { id: 'a', date: '2030-10-14', position: '引导' };
  for (const status of ['已确认', '已签到']) assert.equal(matchesServiceContext({}, context, { 报名状态: status }), true);
  for (const status of ['待筛选', '未入选', '已取消', undefined]) {
    const registration = { 报名状态: status, 签到照片ID: 'synthetic' };
    assert.equal(matchesServiceContext({}, context, registration), false);
    assert.equal(matchesServiceContext({ registrationStatus: 'all' }, context, registration), true);
    assert.ok(attendanceBlockReason(registration, null, true));
  }
  const pending = { 报名状态: '待筛选' };
  assert.equal(matchesServiceContext({ registrationStatus: '待筛选', date: context.date }, context, pending), true);
  assert.equal(matchesServiceContext({ registrationStatus: 'all', date: '2030-10-15' }, context, pending), false);
  assert.equal(matchesServiceContext({ registrationStatus: 'all', session: 'b' }, context, pending), false);
  assert.equal(serviceSession({ 活动ID: 'a' }, children).position, '引导');
});
