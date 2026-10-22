import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BLOOD_POINTS,bloodPointRank,bloodSlotCompare} from '../public/app/shared/blood-points.js';

const slot=(location,slot)=>({location,slot});

test('a day lists positions in the fixed point order before time order',()=>{
 const day=[
  slot('新街口印象汇','上午 10~14点'),
  slot('新街口中央','上午 11~15点'),
  slot('新街口印象汇','下午 13~17点'),
  slot('新街口中央','下午 14~18点'),
 ];
 const ordered=[...day].sort(bloodSlotCompare).map(item=>`${item.location} ${item.slot}`);
 assert.deepEqual(ordered,[
  '新街口中央 上午 11~15点',
  '新街口中央 下午 14~18点',
  '新街口印象汇 上午 10~14点',
  '新街口印象汇 下午 13~17点',
 ]);
});

test('weekend days keep the same point order across all four sites',()=>{
 const day=[
  slot('浦口弘阳广场','上午 11~15点'),
  slot('仙林学则路','上午 10~14点'),
  slot('新街口印象汇','上午 10~14点'),
  slot('新街口中央','上午 11~15点'),
  slot('新街口中央','下午 14~18点'),
  slot('仙林学则路','下午 13~17点'),
  slot('新街口印象汇','下午 13~17点'),
 ];
 const ordered=[...day].sort(bloodSlotCompare).map(item=>item.location);
 assert.deepEqual([...new Set(ordered)],BLOOD_POINTS);
});

test('unknown locations sort after the known points without breaking the time order',()=>{
 const day=[slot('其他点位','上午 09~12点'),slot('新街口中央','下午 14~18点'),slot('新街口中央','上午 11~15点')];
 const ordered=[...day].sort(bloodSlotCompare).map(item=>item.location);
 assert.deepEqual(ordered,['新街口中央','新街口中央','其他点位']);
 assert.equal(bloodPointRank('新街口中央'),0);
 assert.equal(bloodPointRank('未知道位'),BLOOD_POINTS.length);
});
