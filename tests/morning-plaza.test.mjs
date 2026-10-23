import test from 'node:test';
import assert from 'node:assert/strict';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import {
  MORNING_PLAZA_API_PATH,
  MORNING_PLAZA_NOTE_PREVIEW_LENGTH,
  MORNING_PLAZA_PAGE_SIZE,
  morningPlazaMatchesTags,
  morningPlazaRoutes,
  morningPlazaTagTokens,
  toMorningPlazaCardView,
  toMorningPlazaDetailView,
  toMorningPlazaViewer,
} from '../lib/morning/plaza.js';


function row(overrides = {}) {
  return {
    _id: 'row-1',
    名片ID: 'MNG-1',
    账号ID: 'ACC-1',
    真实姓名快照: '本地成员',
    学号快照: '999990002',
    性别快照: '女',
    校区: '仙林',
    昵称: '小南',
    院系快照: '计算机学院',
    年级快照: '2023级',
    展示院系: '是',
    展示年级: '是',
    兴趣标签: JSON.stringify(['摄影', '跑步']),
    备注: '想找一起跑步的同学',
    审核状态: MORNING_CARD_STATUS.PUBLISHED,
    审核意见: '',
    审核人: '',
    审核时间: '',
    提交时间: '2026-10-09T00:00:00.000Z',
    发布时间: '',
    更新时间: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

function harness(rows, { authenticated = true } = {}) {
  const res = { statusCode: 0, payload: null };
  const ctx = {
    requirePortalSession: (_req, response) => {
      if (authenticated) return { username: 'local-member', role: 'member' };
      response.statusCode = 401;
      response.payload = { ok: false, code: 'login_required' };
      return null;
    },
    actor: () => 'ACC-1',
    enforcePublicLimit: () => {},
    getBase: async () => ({}),
    listRows: async () => rows,
    assertCompleteRows: () => {},
    json: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
  };
  return { ctx, res };
}

async function call(rows, { authenticated = true, path = MORNING_PLAZA_API_PATH } = {}) {
  const { ctx, res } = harness(rows, { authenticated });
  await morningPlazaRoutes({ method: 'GET' }, res, new URL(`http://example.test${path}`), ctx);
  return res;
}

test('早安晚安广场要求登录', async () => {
  const res = await call([], { authenticated: false });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, 'login_required');
});

test('平台注册用户没有名片也可以浏览广场', async () => {
  const res = await call([
    row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.cards.length, 1);
  assert.deepEqual(res.payload.viewer, {
    canBrowse: true,
    canInvite: false,
    cardStatus: null,
  });
});

test('早安晚安广场只返回他人已通过名片且不泄露私有字段', async () => {
  const rows = [
    row(),
    row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 昵称: '小林', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-10-09T02:00:00.000Z' }),
    row({ _id: 'row-3', 名片ID: 'MNG-3', 账号ID: 'ACC-3', 昵称: '未审核', 审核状态: MORNING_CARD_STATUS.PENDING }),
    row({ _id: 'row-4', 名片ID: 'MNG-4', 账号ID: 'ACC-1', 昵称: '自己', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ];
  const res = await call(rows);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.cards.length, 1);
  assert.equal(res.payload.cards[0].nickname, '小林');
  assert.equal(res.payload.viewer.canInvite, true);
  assert.deepEqual(Object.keys(res.payload.cards[0]).sort(), ['campus', 'department', 'gender', 'grade', 'hasMoreNote', 'id', 'interestTags', 'nickname', 'notePreview', 'publishedAt'].sort());
  assert.ok(!('realName' in res.payload.cards[0]));
  assert.ok(!('studentId' in res.payload.cards[0]));
});

test('早安晚安广场投影保持公开字段', () => {
  assert.deepEqual(toMorningPlazaCardView(row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED })), {
    id: 'MNG-1',
    nickname: '小南',
    gender: '女',
    campus: '仙林',
    department: '计算机学院',
    grade: '2023级',
    interestTags: ['摄影', '跑步'],
    notePreview: '想找一起跑步的同学',
    hasMoreNote: false,
    publishedAt: null,
  });
});

test('未选择公开的学院和年级不会进入公开投影', () => {
  const view = toMorningPlazaCardView(row({
    展示院系: '否',
    展示年级: '否',
  }));
  assert.equal(view.department, '');
  assert.equal(view.grade, '');
  assert.equal(view.gender, '女');
});

test('名片待审核的注册用户仍可浏览，但暂不能发起邀约', async () => {
  const res = await call([
    row({ 审核状态: MORNING_CARD_STATUS.PENDING }),
    row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.cards.length, 1);
  assert.deepEqual(res.payload.viewer, {
    canBrowse: true,
    canInvite: false,
    cardStatus: MORNING_CARD_STATUS.PENDING,
  });
});

test('同行名片详情对没有名片的注册用户开放，邀约资格单独返回', async () => {
  const res = await call([
    row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ], { path: `${MORNING_PLAZA_API_PATH}/MNG-2` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.card.nickname, '小南');
  assert.equal(res.payload.viewer.canBrowse, true);
  assert.equal(res.payload.viewer.canInvite, false);
});

test('邀约资格只由当前有效名片状态决定', () => {
  const published = toMorningPlazaViewer([
    row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ], 'ACC-1');
  assert.equal(published.canInvite, true);
  assert.equal(published.cardStatus, MORNING_CARD_STATUS.PUBLISHED);

  const withdrawn = toMorningPlazaViewer([
    row({ 审核状态: MORNING_CARD_STATUS.WITHDRAWN }),
  ], 'ACC-1');
  assert.equal(withdrawn.canInvite, false);
  assert.equal(withdrawn.cardStatus, null);
});

test('早安晚安广场每页六条并按发布时间排序', async () => {
  const rows = [row()];
  for (let index = 0; index < 8; index += 1) {
    rows.push(row({
      _id: `card-${index}`,
      名片ID: `MNG-PAGE-${index + 1}`,
      账号ID: `ACC-PAGE-${index + 1}`,
      昵称: `分页同学${index + 1}`,
      审核状态: MORNING_CARD_STATUS.PUBLISHED,
      发布时间: `2026-10-0${Math.min(9, index + 1)}T02:00:00.000Z`,
    }));
  }
  const first = await call(rows, { path: `${MORNING_PLAZA_API_PATH}?page=1` });
  assert.equal(first.payload.cards.length, MORNING_PLAZA_PAGE_SIZE);
  assert.equal(first.payload.stats.total, 8);
  assert.equal(first.payload.stats.totalPages, 2);
  assert.equal(first.payload.stats.hasNext, true);
  const second = await call(rows, { path: `${MORNING_PLAZA_API_PATH}?page=2` });
  assert.equal(second.payload.cards.length, 2);
  assert.equal(second.payload.stats.hasPrevious, true);

  const orderRows = [
    row(),
    row({ _id: 'newer', 名片ID: 'MNG-NEWER', 账号ID: 'ACC-NEWER', 昵称: '较新名片', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-10-09T02:00:00.000Z' }),
    row({ _id: 'older', 名片ID: 'MNG-OLDER', 账号ID: 'ACC-OLDER', 昵称: '较早名片', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-08-01T02:00:00.000Z' }),
  ];
  const ordered = await call(orderRows);
  assert.equal(ordered.payload.cards[0].id, 'MNG-NEWER');
});

test('早安晚安广场搜索只匹配兴趣标签并支持多标签同时命中', async () => {
  const rows = [
    row(),
    row({ _id: 'card-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 昵称: '摄影达人', 兴趣标签: JSON.stringify(['摄影', '跑步']), 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
    row({ _id: 'card-3', 名片ID: 'MNG-3', 账号ID: 'ACC-3', 昵称: '读书同学', 兴趣标签: JSON.stringify(['读书', '电影']), 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
    row({ _id: 'card-4', 名片ID: 'MNG-4', 账号ID: 'ACC-4', 昵称: '摄影社团', 兴趣标签: JSON.stringify(['音乐']), 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ];
  const single = await call(rows, { path: `${MORNING_PLAZA_API_PATH}?q=${encodeURIComponent('摄影')}` });
  assert.deepEqual(single.payload.cards.map((card) => card.id), ['MNG-2']);
  const multiple = await call(rows, { path: `${MORNING_PLAZA_API_PATH}?q=${encodeURIComponent('摄影 跑步')}` });
  assert.deepEqual(multiple.payload.cards.map((card) => card.id), ['MNG-2']);
  assert.deepEqual(morningPlazaTagTokens('摄影、跑步 羽毛球'), ['摄影', '跑步', '羽毛球']);
  assert.equal(morningPlazaMatchesTags(['摄影', '跑步'], '摄影 跑步'), true);
  assert.equal(morningPlazaMatchesTags(['摄影'], '摄影 跑步'), false);
});

test('早安晚安广场长留言只返回摘要且详情返回完整留言', async () => {
  const longNote = '第一条'.repeat(MORNING_PLAZA_NOTE_PREVIEW_LENGTH);
  const rows = [
    row(),
    row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 备注: longNote }),
  ];
  const list = await call(rows);
  assert.equal(list.payload.cards[0].hasMoreNote, true);
  assert.match(list.payload.cards[0].notePreview, /…$/);
  assert.ok(list.payload.cards[0].notePreview.length <= MORNING_PLAZA_NOTE_PREVIEW_LENGTH);

  const detail = await call(rows, { path: `${MORNING_PLAZA_API_PATH}/MNG-2` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.payload.card.note, longNote);
  assert.ok(!('accountId' in detail.payload.card));
});

test('早安晚安名片详情投影保持完整公开留言', () => {
  assert.deepEqual(toMorningPlazaDetailView(row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED })), {
    id: 'MNG-1',
    nickname: '小南',
    gender: '女',
    campus: '仙林',
    department: '计算机学院',
    grade: '2023级',
    interestTags: ['摄影', '跑步'],
    note: '想找一起跑步的同学',
    publishedAt: null,
  });
});
