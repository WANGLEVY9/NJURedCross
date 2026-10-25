import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeTemplate, syncNoticeSchedule } from '../public/app/shared/activity-management.js';

test('notice schedule accepts arbitrary Beijing minutes and seconds, retaining precision', () => {
  for (const [input, time] of [
    ['2030-10-17T09:17:42+08:00', '09:17:42'],
    ['2030-10-17T23:59:59+08:00', '23:59:59'],
    ['2030-10-17T09:17:00+08:00', '09:17'],
    ['2030-10-17T09:17+08:00', '09:17'],
    ['2030-10-17T09:17', '09:17'],
  ]) {
    const expected = `【报名开始】：10月17日 ${time} 开始报名（北京时间）`;
    assert.ok(noticeTemplate({ publishAt: input }).includes(expected));
    const result = syncNoticeSchedule('正文\r\n【报名开始】：旧时间\r\n【报名开始】：重复\r\n【报名方式】：平台', input);
    assert.equal(result, `正文\r\n${expected}\r\n【报名方式】：平台`);
    assert.equal(syncNoticeSchedule(result, input), result);
  }
});

test('invalid dates, times and non-Beijing offsets do not produce a schedule announcement', () => {
  for (const value of ['2030-02-29T09:17:42+08:00', '2030-04-31T09:17:42+08:00', '2030-13-01T09:17:42+08:00', '2030-10-17T24:00:00+08:00', '2030-10-17T09:60:00+08:00', '2030-10-17T09:17:60+08:00', '2030-10-17T09:17:42Z', '2030-10-17T09:17:42+07:00']) {
    assert.ok(!noticeTemplate({ publishAt: value }).includes('【报名开始】'), value);
  }
  assert.match(noticeTemplate({ publishAt: '2028-02-29T09:17:42+08:00' }), /2月29日 09:17:42/);
});

test('notice keeps a fully dated slot intact and preserves public content over internal work', () => {
  const date = '2030-10-17';
  for (const slot of ['09:17:42-12:00:00', `${date} 09:17:42-12:00:00`, `${date}T09:17:42+08:00 至 2030-10-18T12:00:00+08:00`]) {
    const text = noticeTemplate({ date, slot, work: '岗位专属安排', content: '父活动概述' });
    const line = text.split('\n').find(line => line.startsWith('【活动时间】'));
    assert.equal(line.split(date).length - 1, 1);
    assert.ok(line.endsWith(slot));
    assert.match(text, /【活动内容】：父活动概述/);
    assert.ok(!text.includes('岗位专属安排'));
  }
  assert.match(noticeTemplate({ content: '父活动概述' }), /【活动内容】：父活动概述/);
  assert.match(noticeTemplate({ work: '无公开内容时的工作说明' }), /【活动内容】：无公开内容时的工作说明/);
  assert.match(noticeTemplate({ content: '岗位子活动公开说明', work: '岗位子活动公开说明' }), /【活动内容】：岗位子活动公开说明/);
});
