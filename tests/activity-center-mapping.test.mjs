import test from 'node:test';
import assert from 'node:assert/strict';

import { MEDIA_CENTERS, normalizeMediaCenter } from '../lib/attachment/store.js';
import {
  ACTIVITY_CATEGORY_TO_CENTER,
  resolveMediaCenter,
  listActivityNames,
} from '../lib/attachment/activities.js';

test('归档部门固定为四项，且「苏州分部」已移除', () => {
  assert.deepEqual([...MEDIA_CENTERS], ['生命中心', '博爱中心', '综事中心', '主席团活动']);
  assert.equal(MEDIA_CENTERS.includes('苏州分部'), false);
  assert.equal(normalizeMediaCenter('苏州分部'), '');
});

test('活动广场分类映射到四个归档部门', () => {
  // 一一对应
  assert.equal(resolveMediaCenter('生命中心'), '生命中心');
  assert.equal(resolveMediaCenter('博爱中心'), '博爱中心');
  assert.equal(resolveMediaCenter('综事中心'), '综事中心');
  // 名字不同但同一含义
  assert.equal(resolveMediaCenter('主席团专项'), '主席团活动');
  // 两个专项并入博爱中心
  assert.equal(resolveMediaCenter('献血车专项'), '博爱中心');
  assert.equal(resolveMediaCenter('一加助残专项'), '博爱中心');
  // 2026-10-28 定案：排班专项并入主席团活动
  assert.equal(resolveMediaCenter('排班专项'), '主席团活动');
  // 7 个活动分类全部有落点
  for (const category of ['主席团专项', '博爱中心', '生命中心', '综事中心', '排班专项', '一加助残专项', '献血车专项']) {
    assert.ok(resolveMediaCenter(category), `${category} 应有归档部门`);
  }
});

test('未登记的分类不猜测归属，保持未归类（任意部门可见）', () => {
  assert.equal(resolveMediaCenter('随便写的'), '');
  assert.equal(resolveMediaCenter('公益活动'), '', '已停用的旧标签仍视为未归类');
  assert.equal(resolveMediaCenter(''), '');
  assert.equal(resolveMediaCenter(null), '');
  assert.equal(resolveMediaCenter(undefined), '');
});

test('映射结果必须是合法部门，避免写出表外目录名', () => {
  for (const value of Object.values(ACTIVITY_CATEGORY_TO_CENTER)) {
    assert.ok(MEDIA_CENTERS.includes(value), `${value} 不在 MEDIA_CENTERS 内`);
  }
});

test('listActivityNames 把活动分类翻译成归档部门', async () => {
  const rows = [
    { 活动名称: '献血车周', 状态: '报名中', 中心: '献血车专项' },
    { 活动名称: '助残日', 状态: '报名中', 中心: '一加助残专项' },
    { 活动名称: '主席团例会', 状态: '报名中', 中心: '主席团专项' },
    { 活动名称: '急救培训', 状态: '报名中', 中心: '综事中心' },
    { 活动名称: '排班演练', 状态: '报名中', 中心: '排班专项' },
    { 活动名称: '老活动', 状态: '已结束', 中心: '' },
    { 活动名称: '已移出的分部', 状态: '已结束', 中心: '苏州分部' },
    { 活动名称: '献血车周', 状态: '报名中', 中心: '献血车专项' },
  ];
  const ctx = {
    getBase: async () => ({ listRows: async () => rows }),
    tables: { project: '活动项目表' },
  };
  const list = await listActivityNames(ctx);
  const byName = Object.fromEntries(list.map((x) => [x.name, x.center]));
  assert.equal(byName['献血车周'], '博爱中心');
  assert.equal(byName['助残日'], '博爱中心');
  assert.equal(byName['主席团例会'], '主席团活动');
  assert.equal(byName['急救培训'], '综事中心');
  assert.equal(byName['排班演练'], '主席团活动');
  assert.equal(byName['老活动'], '');
  assert.equal(byName['已移出的分部'], '');
  // 重名去重后只保留一条
  assert.equal(list.filter((x) => x.name === '献血车周').length, 1);
});

/* ---------------- 跨库：志愿服务平台的「已结束」活动 ---------------- */

import { finishedSubmissionActivities } from '../lib/events/public-workflow.js';
import { workflowApprovalHash } from '../lib/events/workflow.js';

/** 造一条「已批准」的网站活动流程表行。 */
function approvedRow(overrides = {}) {
  const row = {
    活动ID: 'WF-1',
    活动名称: '献血周志愿服务活动',
    活动类别: '志愿服务',
    负责人账号ID: 'ACC-1',
    申请版本: 'v1',
    报名日期: '2026-10-01',
    报名时段: '08:00-12:00',
    岗位: '志愿者',
    容量: 10,
    服务时长: 4,
    培训时长: 0,
    交通时长: 0,
    地点: '南京',
    工作内容: '献血车引导',
    通知草稿: '',
    报名页配置: '{}',
    准备状态: '就绪',
    状态: '已结束',
    组织类别: '主席团专项',
    ...overrides,
  };
  row['批准版本'] = overrides.批准版本 ?? row.申请版本;
  row['批准摘要'] = overrides.批准摘要 ?? workflowApprovalHash(row);
  return row;
}

test('取「已结束 + 进行中」的活动，报名中/已归档一律不要', () => {
  // 2026-10-27 定案：进行中的活动也可以投稿（现场通讯/预热稿边办边投）。
  const events = [
    approvedRow({ 活动ID: 'A', 活动名称: '已结束活动', 状态: '已结束' }),
    approvedRow({ 活动ID: 'B', 活动名称: '报名中活动', 状态: '报名中' }),
    approvedRow({ 活动ID: 'C', 活动名称: '进行中活动', 状态: '进行中' }),
    approvedRow({ 活动ID: 'D', 活动名称: '已归档活动', 状态: '已归档' }),
  ];
  const out = finishedSubmissionActivities(events);
  assert.deepEqual(out.map((x) => x.name), ['已结束活动', '进行中活动']);
  assert.deepEqual(out.map((x) => x.status), ['已结束', '进行中']);
});

test('未批准、已被替代、组合报名的活动都排除', () => {
  const tampered = approvedRow({ 活动ID: 'E', 活动名称: '摘要被改' });
  tampered['批准摘要'] = 'deadbeef';
  const events = [
    approvedRow({ 活动ID: 'F', 活动名称: '正常活动' }),
    tampered,
    approvedRow({ 活动ID: 'G', 活动名称: '被替代', sourceSuperseded: true }),
    approvedRow({ 活动ID: 'H', 活动名称: '组合报名', 报名页配置: JSON.stringify({ bookingMode: 'grouped' }) }),
  ];
  assert.deepEqual(finishedSubmissionActivities(events).map((x) => x.name), ['正常活动']);
});

test('同名活动去重，中心取「组织类别」', () => {
  const events = [
    approvedRow({ 活动ID: 'I', 活动名称: '献血周', 组织类别: '主席团专项' }),
    approvedRow({ 活动ID: 'J', 活动名称: '献血周', 组织类别: '主席团专项' }),
    approvedRow({ 活动ID: 'K', 活动名称: '急救培训', 组织类别: '' }),
  ];
  const out = finishedSubmissionActivities(events);
  assert.equal(out.filter((x) => x.name === '献血周').length, 1);
  assert.equal(out.find((x) => x.name === '献血周').center, '主席团专项');
  assert.equal(out.find((x) => x.name === '急救培训').center, '');
});

test('listActivityNames 合并跨库活动，同名以本库登记为准，跨库中心经映射', async () => {
  const ctx = {
    getBase: async () => ({ listRows: async () => [{ 活动名称: '献血周', 状态: '报名中', 中心: '生命中心' }] }),
    tables: { project: '活动项目表' },
    workflowActivities: async () => [
      { name: '献血周', center: '主席团专项' },
      { name: '急救培训', center: '主席团专项' },
      { name: '献血车服务', center: '献血车专项' },
      { name: '无主活动', center: '' },
    ],
  };
  const list = await listActivityNames(ctx);
  const byName = Object.fromEntries(list.map((x) => [x.name, x.center]));
  assert.equal(byName['献血周'], '生命中心', '本库登记优先');
  assert.equal(byName['急救培训'], '主席团活动', '主席团专项 → 主席团活动');
  assert.equal(byName['献血车服务'], '博爱中心', '献血车专项 → 博爱中心');
  assert.equal(byName['无主活动'], undefined, '未归类的跨库活动不接入');
  assert.equal(list.length, 3, '只保留能落到部门的活动');
});

test('跨库活动中没有可映射部门的一律不接入（已停用的旧分类也一样）', async () => {
  const ctx = {
    getBase: async () => ({ listRows: async () => [] }),
    tables: { project: '活动项目表' },
    workflowActivities: async () => [
      { name: '有归类的', center: '综事中心' },
      { name: '空组织类别', center: '' },
      { name: '停用分类-公益活动', center: '公益活动' },
      { name: '停用分类-红十字生命教育+', center: '红十字生命教育+' },
      { name: '未知分类', center: '某个已废弃标签' },
    ],
  };
  const list = await listActivityNames(ctx);
  assert.deepEqual(list.map((x) => x.name), ['有归类的']);
  assert.equal(list[0].center, '综事中心');
});

test('跨库读取失败时降级为只读本库，不影响投稿', async () => {
  const ctx = {
    getBase: async () => ({ listRows: async () => [{ 活动名称: '本地活动', 状态: '报名中', 中心: '综事中心' }] }),
    tables: { project: '活动项目表' },
    workflowActivities: async () => { throw new Error('volunteer base down'); },
  };
  const list = await listActivityNames(ctx);
  assert.deepEqual(list.map((x) => x.name), ['本地活动']);
});

test('ctx 未提供跨库能力时保持原有行为', async () => {
  const ctx = {
    getBase: async () => ({ listRows: async () => [{ 活动名称: '只有本地', 状态: '报名中', 中心: '生命中心' }] }),
    tables: { project: '活动项目表' },
  };
  const list = await listActivityNames(ctx);
  assert.deepEqual(list.map((x) => x.name), ['只有本地']);
});
