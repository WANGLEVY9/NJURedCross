import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MORNING_CARD_STATUS } from '../lib/morning/api.js';
import {
  MORNING_PLAZA_API_PATH,
  MORNING_PLAZA_NOTE_PREVIEW_LENGTH,
  morningPlazaRoutes,
  toMorningPlazaCardView,
  toMorningPlazaDetailView,
} from '../lib/morning/plaza.js';

const mainSource = await readFile(new URL('../public/app/main.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../public/app/core/api.js', import.meta.url), 'utf8');
const warmthSource = await readFile(new URL('../public/app/portal/pages/warmth.js', import.meta.url), 'utf8');
const drawerSource = await readFile(new URL('../public/app/portal/morning-drawer.js', import.meta.url), 'utf8');
const plazaSource = await readFile(new URL('../public/app/portal/pages/morning-plaza.js', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../public/app/portal/pages/morning-card-detail.js', import.meta.url), 'utf8');
const overlaySource = await readFile(new URL('../public/app/ui/overlay.js', import.meta.url), 'utf8');
const componentsCss = await readFile(new URL('../public/styles/components.css', import.meta.url), 'utf8');
const sampleScript = await readFile(new URL('../scripts/seed-morning-plaza-samples.mjs', import.meta.url), 'utf8');
const packageSource = await readFile(new URL('../package.json', import.meta.url), 'utf8');

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
    审核状态: MORNING_CARD_STATUS.PENDING,
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
  assert.deepEqual(Object.keys(res.payload.cards[0]).sort(), ['campus', 'hasMoreNote', 'id', 'interestTags', 'nickname', 'notePreview', 'publishedAt'].sort());
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
  });
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
    publishedAt: null,
  });
});

test('早安晚安广场前端入口与页面已接入', () => {
  assert.ok(mainSource.includes("path: '/morning/plaza/:cardId'") && mainSource.includes("path: '/morning/plaza'"), 'plaza routes missing');
  assert.ok(apiSource.includes('plaza: () => request'), 'plaza API client missing');
  assert.ok(apiSource.includes('plazaCard: (id) => request'), 'plaza detail API client missing');
  assert.ok(warmthSource.includes('进入广场') && warmthSource.includes('/morning/plaza'), 'built-in square entry missing');
  assert.ok(warmthSource.includes('morning-plaza-entry'), 'plaza module missing');
  assert.ok(drawerSource.includes('navigate') && drawerSource.includes('/morning/plaza'), 'signup receipt plaza action missing');
  assert.ok(plazaSource.includes('morningApi.plaza()') && plazaSource.includes('/morning/plaza/'), 'plaza page missing card links');
  assert.ok(plazaSource.includes('openMorningCardDetailModal') && plazaSource.includes('scrim--blur-strong'), 'plaza card detail modal missing');
  assert.ok(plazaSource.includes('morning-plaza-card__avatar') && plazaSource.includes('morning-plaza-card__foot'), 'card design hooks missing');
  assert.ok(detailSource.includes('morningApi.plazaCard(cardId)') && detailSource.includes('morning-card-detail'), 'card detail page missing');
  assert.ok(overlaySource.includes('scrimClass') && componentsCss.includes('.scrim--blur-strong'), 'strong blur scrim support missing');
  assert.ok(packageSource.includes('morning:plaza-samples') && sampleScript.includes("审核状态: '已发布'"), 'local sample plaza seed missing');
});
