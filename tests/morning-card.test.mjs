import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MORNING_CARD_STATUS,
  isActiveMorningCardStatus,
  normalizeInterestTags,
  morningRoutes,
  toMorningCardView,
  validateMorningCardInput,
} from '../lib/morning/api.js';


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
  });
  assert.deepEqual(value.interestTags, ['摄影', '跑步']);
  assert.equal(value.allowEmail, true);
  const noEmail = validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: ['摄影'],
    consent: true,
    allowEmail: false,
  });
  assert.equal(noEmail.allowEmail, false);
  assert.throws(() => validateMorningCardInput({
    nickname: '小南',
    campus: '仙林',
    interestTags: [],
    consent: true,
  }), /至少填写一个兴趣标签/);
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
    兴趣标签: JSON.stringify(['摄影', '跑步']),
    备注: '自我介绍',
    允许评论邮件: '否',
    审核状态: MORNING_CARD_STATUS.PENDING,
    提交时间: '2026-10-08T00:00:00.000Z',
  });
  assert.equal(view.status, '待审核');
  assert.equal(view.allowEmail, false);
  assert.deepEqual(view.interestTags, ['摄影', '跑步']);
});

test('主动退出使用已退出状态并从个人名片读取中隐藏', () => {
  assert.equal(MORNING_CARD_STATUS.WITHDRAWN, '已退出');
  assert.equal(isActiveMorningCardStatus('待审核'), true);
  assert.equal(isActiveMorningCardStatus('已发布'), true);
  assert.equal(isActiveMorningCardStatus('已退出'), false);
  assert.equal(isActiveMorningCardStatus('已下架'), false);
});

test('已发布名片不能通过重新提交绕过审核直接回到待审核', async () => {
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
  const client = {
    async updateRow() { throw new Error('must not update'); },
    async deleteRow() { throw new Error('must not delete'); },
    async appendRow() { throw new Error('must not append'); },
  };
  const res = { statusCode: 0, payload: null };
  const session = { username: 'local-member', role: 'member' };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => table === '早安晚安兴趣标签表' ? [] : rows,
    assertCompleteRows: () => {},
    requirePortalSession: () => session,
    requirePortalWrite: () => session,
    actor: () => 'ACC-1',
    accountForSession: async () => ({ realName: '本地成员', studentId: '999990002', gender: '女' }),
    readJsonObject: async () => ({ nickname: '小南', campus: '仙林', interestTags: ['摄影'], note: '', consent: true, allowEmail: true }),
    enforcePublicLimit: () => {},
    recordAudit: () => {},
    json: (response, statusCode, payload) => { response.statusCode = statusCode; response.payload = payload; return payload; },
  };
  await morningRoutes({ method: 'POST', headers: {} }, res, new URL('http://example.test/api/morning/card'), ctx);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, 'card_already_published');
});







test('Failed rejoin preserves the withdrawn card and its history', async()=>{
 const old={_id:'old',名片ID:'OLD',账号ID:'A',审核状态:'已退出'};
 let deleted=false;const client={async deleteRow(){deleted=true;},async appendRow(){throw new Error('write failed');}};
 const session={username:'x'};
 const ctx={getBase:async()=>client,listRows:async(_base,table)=>table==='早安晚安名片表'?[old]:[],assertCompleteRows(){},requirePortalWrite:()=>session,actor:()=> 'A',accountForSession:async()=>({realName:'test',studentId:'123',gender:'女'}),readJsonObject:async()=>({nickname:'test',campus:'仙林',interestTags:['摄影'],consent:true}),enforcePublicLimit(){},recordAudit(){},json(){}};
 await assert.rejects(morningRoutes({method:'POST'},{},new URL('https://test/api/morning/card'),ctx),/write failed/);
 assert.equal(deleted,false);assert.equal(old.审核状态,'已退出');
});
