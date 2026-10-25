import test from 'node:test';
import assert from 'node:assert/strict';
import { readMorningGrades } from '../lib/morning/grade-source.js';
import {
  morningPlazaRoutes,
  toMorningPlazaCardView,
  toMorningPlazaDetailView,
} from '../lib/morning/plaza.js';
import { MORNING_CARD_STATUS } from '../lib/morning/shared.js';

function profile(studentId, realName, grade) {
  return { _id: `profile-${studentId}`, 学号: studentId, 姓名: realName, 年级: grade };
}

function card(overrides = {}) {
  return {
    名片ID: 'MNG-GRADE',
    账号ID: 'ACC-OWNER',
    真实姓名快照: '合成同学',
    学号快照: '999990001',
    年级快照: '旧年级快照',
    展示年级: '是',
    审核状态: MORNING_CARD_STATUS.PUBLISHED,
    ...overrides,
  };
}

test('年级以真实个人主页字段为准并支持单选对象值', async () => {
  const rows = [
    profile('999990001', '合成同学', { display_value: '25本' }),
    profile('999990002', '合成研究生', '26研'),
  ];
  const grades = await readMorningGrades({
    query: async sql => {
      assert.match(sql, /`个人主页（编辑版）`/);
      assert.match(sql, /999990001/);
      return rows;
    },
  }, [
    { studentId: '999990001', realName: '合成同学' },
    { studentId: '999990002', realName: '合成研究生' },
  ]);
  assert.equal(grades.get('999990001'), '25本');
  assert.equal(grades.get('999990002'), '26研');
  assert.equal(toMorningPlazaCardView(card(), grades).grade, '25本');
  assert.equal(toMorningPlazaDetailView(card(), grades).grade, '25本');
});

test('姓名不一致、重复资料或源字段为空时不展示旧快照', async () => {
  const grades = await readMorningGrades({
    query: async () => [
      profile('999990001', '另一位同学', '25本'),
      profile('999990002', '重复资料', '26研'),
      profile('999990002', '重复资料', '26研'),
      profile('999990003', '空年级', ''),
    ],
  }, [
    { studentId: '999990001', realName: '合成同学' },
    { studentId: '999990002', realName: '重复资料' },
    { studentId: '999990003', realName: '空年级' },
  ]);
  for (const value of grades.values()) assert.equal(value, '');
  assert.equal(toMorningPlazaCardView(card(), grades).grade, '');
});

test('未选择公开年级时不会读取或显示个人主页年级', async () => {
  const grades = new Map([['999990001', '25本']]);
  assert.equal(toMorningPlazaCardView(card({ 展示年级: '否' }), grades).grade, '');
  assert.equal(toMorningPlazaDetailView(card({ 展示年级: '否' }), grades).grade, '');
});

test('同行广场列表与详情使用 SeaTable 个人主页年级', async () => {
  const rows = [
    card({
      名片ID: 'MNG-PUBLIC',
      账号ID: 'ACC-PUBLIC',
      真实姓名快照: '公开同学',
      学号快照: '999990101',
      年级快照: '过期年级',
      展示年级: '是',
    }),
    card({
      名片ID: 'MNG-PRIVATE',
      账号ID: 'ACC-PRIVATE',
      真实姓名快照: '不公开同学',
      学号快照: '999990102',
      展示年级: '否',
    }),
  ];
  const requested = [];
  const ctx = {
    requirePortalSession: () => ({ username: 'viewer' }),
    actor: () => 'ACC-VIEWER',
    enforcePublicLimit: () => {},
    getBase: async () => ({}),
    listRows: async () => rows,
    assertCompleteRows: () => {},
    resolveMorningGrades: async (people) => {
      requested.push(...people);
      return new Map(people.map((person) => [person.studentId, '25本']));
    },
    json: (_res, statusCode, payload) => ({ statusCode, payload }),
  };

  const list = await morningPlazaRoutes(
    { method: 'GET' },
    {},
    new URL('http://example.test/api/morning/cards'),
    ctx,
  );
  assert.equal(list.payload.cards.find((item) => item.id === 'MNG-PUBLIC').grade, '25本');
  assert.deepEqual(requested, [{ studentId: '999990101', realName: '公开同学' }]);

  const detail = await morningPlazaRoutes(
    { method: 'GET' },
    {},
    new URL('http://example.test/api/morning/cards/MNG-PUBLIC'),
    ctx,
  );
  assert.equal(detail.payload.card.grade, '25本');
});
