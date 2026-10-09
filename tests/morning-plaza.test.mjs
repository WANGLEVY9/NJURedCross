import test from 'node:test';
import assert from 'node:assert/strict';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import {
  MORNING_PLAZA_HEAT_COMMENT_WEIGHT,
  MORNING_PLAZA_API_PATH,
  MORNING_PLAZA_NOTE_PREVIEW_LENGTH,
  MORNING_PLAZA_PAGE_SIZE,
  morningPlazaHeatScore,
  morningPlazaMatchesTags,
  morningPlazaRoutes,
  morningPlazaTagTokens,
  toMorningPlazaCardView,
  toMorningPlazaDetailView,
} from '../lib/morning/plaza.js';
import { MORNING_COMMENT_TABLE } from '../lib/morning/shared.js';


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

function comment(overrides = {}) {
  return {
    _id: 'comment-1',
    评论ID: 'MNG-CMT-1',
    名片ID: 'MNG-2',
    评论人账号ID: 'ACC-3',
    内容: '你好',
    状态: '可见',
    创建时间: '2026-10-09T01:00:00.000Z',
    ...overrides,
  };
}

function harness(rows, { authenticated = true, comments = [] } = {}) {
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
    listRows: async (_client, table) => table === MORNING_COMMENT_TABLE ? comments : rows,
    assertCompleteRows: () => {},
    json: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
  };
  return { ctx, res };
}

async function call(rows, { authenticated = true, comments = [], path = MORNING_PLAZA_API_PATH } = {}) {
  const { ctx, res } = harness(rows, { authenticated, comments });
  await morningPlazaRoutes({ method: 'GET' }, res, new URL(`http://example.test${path}`), ctx);
  return res;
}

test('早安晚安广场要求登录', async () => {
  const res = await call([], { authenticated: false });
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.code, 'login_required');
});

test('早安晚安广场要求当前账号已经报名', async () => {
  const res = await call([row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED })]);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'morning_card_required');
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
  assert.deepEqual(Object.keys(res.payload.cards[0]).sort(), ['campus', 'commentCount', 'hasMoreNote', 'id', 'interestTags', 'nickname', 'notePreview', 'publishedAt'].sort());
  assert.ok(!('realName' in res.payload.cards[0]));
  assert.ok(!('studentId' in res.payload.cards[0]));
});

test('早安晚安广场投影保持公开字段', () => {
  assert.deepEqual(toMorningPlazaCardView(row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED })), {
    id: 'MNG-1',
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影', '跑步'],
    notePreview: '想找一起跑步的同学',
    hasMoreNote: false,
    publishedAt: null,
    commentCount: 0,
  });
});

test('早安晚安广场拒绝尚未通过审核的本账号', async () => {
  const res = await call([
    row({ 审核状态: MORNING_CARD_STATUS.PENDING }),
    row({ _id: 'row-2', 名片ID: 'MNG-2', 账号ID: 'ACC-2', 审核状态: MORNING_CARD_STATUS.PUBLISHED }),
  ]);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.code, 'morning_card_required');
});

test('早安晚安广场每页六条并按热度与发布时间综合排序', async () => {
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

  const heatRows = [
    row(),
    row({ _id: 'quiet', 名片ID: 'MNG-QUIET', 账号ID: 'ACC-QUIET', 昵称: '无评论', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-10-09T02:00:00.000Z' }),
    row({ _id: 'hot', 名片ID: 'MNG-HOT', 账号ID: 'ACC-HOT', 昵称: '有评论', 审核状态: MORNING_CARD_STATUS.PUBLISHED, 发布时间: '2026-08-01T02:00:00.000Z' }),
  ];
  const hot = await call(heatRows, {
    comments: [
      comment({ _id: 'c1', 名片ID: 'MNG-HOT' }),
      comment({ _id: 'c2', 名片ID: 'MNG-HOT' }),
      comment({ _id: 'c3', 名片ID: 'MNG-HOT', 状态: '已举报' }),
    ],
  });
  assert.equal(hot.payload.cards[0].id, 'MNG-HOT');
  assert.equal(hot.payload.cards[0].commentCount, 2);
  assert.ok(morningPlazaHeatScore({ commentCount: 2, publishedAt: '2026-08-01', now: Date.parse('2026-10-09') }) > 0);
  assert.equal(MORNING_PLAZA_HEAT_COMMENT_WEIGHT, 10);
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

test('早安晚安广场长备注只返回摘要且详情返回完整备注', async () => {
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

test('早安晚安名片详情投影保持完整公开备注', () => {
  assert.deepEqual(toMorningPlazaDetailView(row({ 审核状态: MORNING_CARD_STATUS.PUBLISHED })), {
    id: 'MNG-1',
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影', '跑步'],
    note: '想找一起跑步的同学',
    allowEmail: true,
    publishedAt: null,
  });
});




