import test from 'node:test';
import assert from 'node:assert/strict';
import {finalHoursDates} from '../lib/events/final-hours-dates.js';
const job=config=>({报名日期:'2030-01-01',报名时段:'上午',报名页配置:JSON.stringify(config)});
test('final hours include the exact job date and minutes, rather than only a registration slot',()=>{
 const row={报名日期:'2030-01-01',报名时段:'上午'};
 assert.equal(finalHoursDates(job({ordinary:{start:'2030-01-02T09:15:00+08:00',end:'2030-01-02T11:45:00+08:00'}}),row),'2030-01-02 09:15—11:45');
 assert.equal(finalHoursDates(job({window:{start:'2030-01-01T23:30:00+08:00',end:'2030-01-03T01:15:00+08:00'}}),row),'2030-01-01 23:30 — 2030-01-03 01:15');
 assert.equal(finalHoursDates(job({window:{start:'2030-01-01T09:15:30+08:00',end:'2030-01-01T11:45:45+08:00'}}),row),'2030-01-01 09:15:30—11:45:45');
});
test('legacy fallback keeps a known date with the slot, without inventing clock times or duplicating dates',()=>{
 assert.equal(finalHoursDates(job({}),{报名日期:'2030-01-02',报名时段:'下午'}),'2030-01-02 下午');
 assert.equal(finalHoursDates(job({}),{报名日期:'2030-01-02',报名时段:'2030-01-02 14:10—16:40'}),'2030-01-02 14:10—16:40');
 assert.equal(finalHoursDates({},{}),'');
 assert.equal(finalHoursDates(job({window:{start:'invalid',end:'invalid'}}),{}),'2030-01-01 上午');
});
