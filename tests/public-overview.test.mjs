import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {countPublicOpenSeats} from '../lib/events/public-overview.js';

test('homepage seats exclude indefinite registries and recurring duties, keeping fixed-date schedule seats',()=>{
 const events=[
  {status:'报名中',remaining:12},
  {status:'报名中',scheduled:true,remaining:4},
  {status:'报名中',longTerm:true,registryType:'component-donation',remaining:100000},
  {status:'报名中',registryType:'province-service',remaining:4},
  {status:'报名中',recurringDuty:true,remaining:30},
  {status:'报名中',blood:{start:'2030-12-09T09:00:00+08:00'},remaining:62},
  {status:'进行中',remaining:20},
  {status:'已结束',remaining:9},
  {status:'报名中',registrationOpen:false,remaining:8},
 ];
 const original=structuredClone(events);
 assert.equal(countPublicOpenSeats(events),16);
 assert.deepEqual(events,original);
 assert.equal(countPublicOpenSeats(events.slice(2)),0);
});

test('valid large short-term capacities remain eligible and missing or invalid counts cannot inflate totals',()=>{
 assert.equal(countPublicOpenSeats([
  {status:'报名中',remaining:'3'},
  {status:'报名中',remaining:100000},
  ...[-1,undefined,null,'bad',Infinity].map(remaining=>({status:'报名中',remaining})),
 ]),100003);
 assert.equal(countPublicOpenSeats([]),0);
});

test('public overview uses the new seat total without changing programme counts or registration history',async()=>{
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const start=source.indexOf('async function loadPublicOverview(client) {'),end=source.indexOf('\n/**',start);
 assert.ok(start>=0&&end>start);
 const events=[
  {status:'报名中',remaining:7,confirmed:2,waitlisted:1},
  {status:'报名中',longTerm:true,remaining:100000,confirmed:5,waitlisted:0},
  {status:'已结束',remaining:0,confirmed:3,waitlisted:0},
 ];
 const context=vm.createContext({countPublicOpenSeats,getPublicEvents:async()=>events,listAllRows:async()=>[{},{}],assertCompleteRows:()=>{},inventoryTable:'synthetic-inventory',publicPrograms:[],publicEmailDomains:[]});
 vm.runInContext(source.slice(start,end),context);
 const result=await context.loadPublicOverview({});
 assert.equal(result.stats.openSeats,7);
 assert.equal(result.stats.openEvents,2);
 assert.equal(result.stats.totalRegistrations,11);
 assert.equal(result.stats.inventoryCategories,2);
});
