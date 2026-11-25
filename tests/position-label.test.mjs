import test from 'node:test';
import assert from 'node:assert/strict';
import {positionOptionLabel} from '../public/app/shared/activity-running.js';

/**
 * 分岗位活动的各岗位行常常共用同一个「地点」。补录下拉曾经以地点打头，
 * 于是「第一打卡点」「第二打卡点」…在选项里显示成同一串文字，操作人分不出来，
 * 只能顺着默认值提交，补录就全部落在第一岗位。岗位名必须在前，且同地点下互不相同。
 */
test('positions sharing one place still produce distinct labels',()=>{
 const base={活动名称:'11.22 校园防艾闯关赛',地点:'南京大学仙林校区',报名日期:'2026-11-22',报名时段:'14:00:00-16:00:00'};
 const positions=['第一打卡点','第二打卡点','第三打卡点','第四打卡点','第五打卡点','摄影志愿者'];
 const labels=positions.map(岗位=>positionOptionLabel({...base,岗位}));
 assert.equal(new Set(labels).size,positions.length,'同地点多岗位的标签必须互不相同');
 for(const [index,label] of labels.entries())assert.ok(label.startsWith(positions[index]),`岗位名应在最前：${label}`);
});

test('the label leads with the position and keeps the place as a suffix',()=>{
 assert.equal(positionOptionLabel({岗位:'搬运志愿者',地点:'仙林校区校医院',报名日期:'2026-11-22',报名时段:'13:00:00-14:00:00'}),
  '搬运志愿者 · 2026-11-22 13:00:00-14:00:00 · 仙林校区校医院');
 // 时段里已经写了地点时不再重复追加。
 assert.equal(positionOptionLabel({岗位:'服务岗',地点:'合成场馆',报名日期:'2026-11-22',报名时段:'合成场馆 全天'}),
  '服务岗 · 2026-11-22 合成场馆 全天');
});

test('rows without a position fall back to the activity name',()=>{
 assert.equal(positionOptionLabel({活动名称:'合成活动',报名日期:'2026-11-22',报名时段:'全天'}),'合成活动 · 2026-11-22 全天');
 assert.equal(positionOptionLabel({}),'未命名岗位');
 assert.equal(positionOptionLabel(null),'未命名岗位');
});
