import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRegistrationNotice, buildNoticeRow, NOTICE_COLUMNS } from '../lib/events/notice.js';

const complete = {
  name: '仙林校区献血车志愿服务',
  category: '献血车',
  campus: '仙林校区',
  location: '大学生活动中心',
  startAt: '2026-10-20 09:00',
  endAt: '2026-10-20 17:00',
  registrationStart: '2026-10-13 09:00',
  registrationEnd: '2026-10-18 22:00',
  capacity: 12,
  content: '协助献血车现场引导与秩序维护。',
  contact: '李同学',
  qqGroup: '123456789',
};

test('a complete activity yields a notice with no missing fields', () => {
  const notice = renderRegistrationNotice(complete);
  assert.deepEqual(notice.missing, []);
  assert.equal(notice.title, '【活动报名】仙林校区献血车志愿服务');
  assert.match(notice.body, /一、活动时间/);
  assert.match(notice.body, /2026-10-20 09:00 至 2026-10-20 17:00/);
  assert.match(notice.body, /仙林校区 大学生活动中心/);
  assert.match(notice.body, /本次开放 12 人名额/);
  assert.equal(notice.sections.length, 7);
});

test('missing fields are reported instead of blocking generation', () => {
  const notice = renderRegistrationNotice({});
  assert.deepEqual(notice.missing, ['活动名称', '活动地点', '活动时间', '报名时间', '报名名额', '联系人', '答疑群']);
  assert.equal(notice.title, '【活动报名】未命名活动');
  assert.match(notice.body, /（未填写）/);
});

test('a single campus or location satisfies the place requirement', () => {
  assert.equal(renderRegistrationNotice({ ...complete, campus: '' }).missing.includes('活动地点'), false);
  assert.equal(renderRegistrationNotice({ ...complete, location: '' }).missing.includes('活动地点'), false);
  assert.equal(renderRegistrationNotice({ ...complete, campus: '', location: '' }).missing.includes('活动地点'), true);
});

test('a partial time or registration window is reported missing', () => {
  assert.equal(renderRegistrationNotice({ ...complete, endAt: '' }).missing.includes('活动时间'), true);
  assert.equal(renderRegistrationNotice({ ...complete, registrationStart: '' }).missing.includes('报名时间'), true);
});

test('non-positive and non-numeric capacity fall back to an explicit placeholder', () => {
  for (const capacity of [0, -1, Number.NaN, undefined, 'abc']) {
    const notice = renderRegistrationNotice({ ...complete, capacity });
    assert.equal(notice.missing.includes('报名名额'), true, `capacity=${capacity}`);
    assert.match(notice.body, /本次开放 （未填写）名额/);
  }
});

test('empty content falls back to a follow-up notice', () => {
  const notice = renderRegistrationNotice({ ...complete, content: '   ' });
  assert.match(notice.body, /（详见活动详情，请关注后续通知）/);
});

test('buildNoticeRow persists the rendered body and leaves publish time empty for drafts', () => {
  const rendered = renderRegistrationNotice(complete);
  const row = buildNoticeRow({ rendered, input: complete, eventId: 'WF-1', generator: 'admin1', noticeId: 'NOT-1' });
  assert.equal(row.正文, rendered.body);
  assert.equal(row.活动ID, 'WF-1');
  assert.equal(row.通知ID, 'NOT-1');
  assert.equal(row.状态, '草稿');
  assert.equal(row.发布时间, '');
  assert.equal(row.活动时间, '2026-10-20 09:00 ~ 2026-10-20 17:00');
  for (const column of NOTICE_COLUMNS) assert.ok(column in row, `missing column ${column}`);
});

test('buildNoticeRow stamps publish time only when the row is published', () => {
  const rendered = renderRegistrationNotice(complete);
  const row = buildNoticeRow({ rendered, input: complete, eventId: 'WF-1', generator: 'admin1', noticeId: 'NOT-1', status: '已发布' });
  assert.equal(row.状态, '已发布');
  assert.match(row.发布时间, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildNoticeRow tolerates a missing render result', () => {
  const row = buildNoticeRow({ rendered: null, input: {}, eventId: '', generator: '', noticeId: '' });
  assert.equal(row.正文, '');
  assert.equal(row.活动名称, '');
});
