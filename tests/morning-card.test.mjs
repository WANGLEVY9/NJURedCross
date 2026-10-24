import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MORNING_CARD_STATUS,
  MORNING_NOTE_MAX_LENGTH,
  isActiveMorningCardStatus,
  normalizeInterestTags,
  morningRoutes,
  toMorningCardView,
  validateMorningCardInput,
} from '../lib/morning/api.js';
import { MORNING_REVISION_TABLE } from '../lib/morning/shared.js';


test('早安晚安兴趣标签去重并限制数量与长度', () => {
  assert.deepEqual(normalizeInterestTags('摄影, 跑步，摄影、读书'), ['摄影', '跑步', '读书']);
  assert.throws(() => normalizeInterestTags(['1', '2', '3', '4', '5', '6']), /最多 5 个/);
  assert.throws(() => normalizeInterestTags(['这个标签太长了']), /不能超过 5 字/);
});

test('早安晚安报名校验必填字段', () => {
  const value = validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影', '跑步'],
    note: '想找一起自习的朋友',
    consent: true,
    showDepartment: true,
    showGrade: false,
  });
  assert.deepEqual(value.interestTags, ['摄影', '跑步']);
  assert.equal(value.showDepartment, true);
  assert.equal(value.showGrade, false);
  assert.equal(MORNING_NOTE_MAX_LENGTH, 100);
  assert.throws(() => validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: [],
    consent: true,
  }), /至少填写一个兴趣标签/);
  assert.throws(() => validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影'],
    note: '留'.repeat(101),
    consent: true,
  }), /留言不能超过 100 字/);
});

test('早安晚安名片投影保持审核状态和兴趣标签', () => {
  const view = toMorningCardView({
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
    展示年级: '否',
    兴趣标签: JSON.stringify(['摄影', '跑步']),
    备注: '自我介绍',
    审核状态: MORNING_CARD_STATUS.PENDING,
    提交时间: '2026-10-08T00:00:00.000Z',
  });
  assert.equal(view.status, '待审核');
  assert.equal(view.department, '计算机学院');
  assert.equal(view.grade, '2023级');
  assert.equal(view.showDepartment, true);
  assert.equal(view.showGrade, false);
  assert.deepEqual(view.interestTags, ['摄影', '跑步']);
});

test('报名昵称由用户填写，性别以账号资料为准，学院年级展示由用户选择', async () => {
  let appended;
  const rows = [];
  const client = {
    async appendRow(table, row) {
      if (table === '早安晚安名片表') appended = row;
      return { _id: 'created' };
    },
    async updateRow() { throw new Error('must not update'); },
  };
  const res = { statusCode: 0, payload: null };
  const session = { username: 'local-member', role: 'member' };
  const ctx = {
    getBase: async () => client,
    listRows: async () => rows,
    assertCompleteRows: () => {},
    requirePortalSession: () => session,
    requirePortalWrite: () => session,
    actor: () => 'ACC-1',
    resolveMorningGrades: async () => new Map([['999990002', '25本']]),
    accountForSession: async () => ({
      realName: '本地成员',
      studentId: '999990002',
      gender: '女',
      email: 'member@smail.nju.edu.cn',
      campus: '仙林',
      label: '账号昵称',
      penName: '',
      department: '计算机学院',
      grade: '2023级',
    }),
    readJsonObject: async () => ({
      nickname: '报名昵称',
      campus: '仙林',
      interestTags: ['摄影'],
      note: '',
      consent: true,
      showDepartment: true,
      showGrade: false,
    }),
    enforcePublicLimit: () => {},
    recordAudit: () => {},
    json: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
  };
  await morningRoutes({ method: 'POST', headers: {} }, res, new URL('http://example.test/api/morning/card'), ctx);
  assert.equal(res.statusCode, 201);
  assert.equal(appended.昵称, '报名昵称');
  assert.equal(appended.性别快照, '女');
  assert.equal(appended.院系快照, '计算机学院');
  assert.equal(appended.年级快照, '25本');
  assert.equal(appended.展示院系, '是');
  assert.equal(appended.展示年级, '否');
});

test('主动退出使用已退出状态并从个人名片读取中隐藏', () => {
  assert.equal(MORNING_CARD_STATUS.WITHDRAWN, '已退出');
  assert.equal(isActiveMorningCardStatus('待审核'), true);
  assert.equal(isActiveMorningCardStatus('已发布'), true);
  assert.equal(isActiveMorningCardStatus('已退出'), false);
  assert.equal(isActiveMorningCardStatus('已下架'), false);
});

test('已发布名片的修改进入修订审核且原广场名片保持不变', async () => {
  const rows = [{
    _id: 'card-1',
    名片ID: 'MNG-1',
    账号ID: 'ACC-1',
    校区: '仙林',
    昵称: '小南',
    兴趣标签: JSON.stringify(['摄影']),
    备注: '原名片',
    审核状态: MORNING_CARD_STATUS.PUBLISHED,
    提交时间: '2026-10-09T00:00:00.000Z',
    发布时间: '2026-10-09T01:00:00.000Z',
    更新时间: '2026-10-09T01:00:00.000Z',
  }];
  const revisions = [];
  const client = {
    async updateRow() { throw new Error('published card must not be updated'); },
    async appendRow(table, row) {
      assert.equal(table, MORNING_REVISION_TABLE);
      const created = { ...row, _id: 'revision-1' };
      revisions.push(created);
      return { _id: created._id };
    },
  };
  const res = { statusCode: 0, payload: null };
  const session = { username: 'local-member', role: 'member' };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => table === MORNING_REVISION_TABLE ? revisions : table === '早安晚安兴趣标签表' ? [] : rows,
    assertCompleteRows: () => {},
    requirePortalSession: () => session,
    requirePortalWrite: () => session,
    actor: () => 'ACC-1',
    accountForSession: async () => ({ realName: '本地成员', studentId: '999990002', gender: '女' }),
    readJsonObject: async () => ({ nickname: '新昵称', campus: '鼓楼', interestTags: ['摄影'], note: '新留言', consent: true, showDepartment: true, showGrade: false }),
    enforcePublicLimit: () => {},
    recordAudit: () => {},
    json: (response, statusCode, payload) => { response.statusCode = statusCode; response.payload = payload; return payload; },
  };
  await morningRoutes({ method: 'POST', headers: {} }, res, new URL('http://example.test/api/morning/card'), ctx);
  assert.equal(res.statusCode, 202);
  assert.equal(res.payload.pendingReview, true);
  assert.equal(res.payload.card.nickname, '小南');
  assert.equal(rows[0].审核状态, MORNING_CARD_STATUS.PUBLISHED);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].昵称, '新昵称');
});







test('Failed rejoin preserves the withdrawn card and its history', async()=>{
 const old={_id:'old',名片ID:'OLD',账号ID:'A',审核状态:'已退出'};
 let deleted=false;const client={async deleteRow(){deleted=true;},async appendRow(){throw new Error('write failed');}};
 const session={username:'x'};
 const ctx={getBase:async()=>client,listRows:async(_base,table)=>table==='早安晚安名片表'?[old]:[],assertCompleteRows(){},requirePortalWrite:()=>session,actor:()=> 'A',accountForSession:async()=>({realName:'test',studentId:'123',gender:'女'}),readJsonObject:async()=>({nickname:'test',campus:'仙林',interestTags:['摄影'],consent:true}),enforcePublicLimit(){},recordAudit(){},json(){}};
 await assert.rejects(morningRoutes({method:'POST'},{},new URL('https://test/api/morning/card'),ctx),/write failed/);
 assert.equal(deleted,false);assert.equal(old.审核状态,'已退出');
});
