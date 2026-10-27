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
});

test('未指定的分类不猜测归属，保持未归类（任意部门可见）', () => {
  assert.equal(resolveMediaCenter('排班专项'), '');
  assert.equal(ACTIVITY_CATEGORY_TO_CENTER['排班专项'], undefined);
  assert.equal(resolveMediaCenter('随便写的'), '');
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
  assert.equal(byName['排班演练'], '');
  assert.equal(byName['老活动'], '');
  assert.equal(byName['已移出的分部'], '');
  // 重名去重后只保留一条
  assert.equal(list.filter((x) => x.name === '献血车周').length, 1);
});
