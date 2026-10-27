import {test} from 'node:test';
import assert from 'node:assert/strict';
import {placeProfilePlan,syncPlaceProfiles} from '../lib/events/place-profiles.js';
import {PLACE_TABLE} from '../lib/events/ordinary-places.js';
import {REGISTRATION_TABLE} from '../lib/events/registration-schema.js';
const place={_id:'seat',报名ID:'signup',报名行ID:'row',活动ID:'event',名额状态:'已占用'};
const booking={_id:'row',报名ID:'signup',账号ID:'account',活动ID:'event',报名状态:'已确认',姓名:'报名旧名',学号:'旧学号'};
const account={账号ID:'account',真实姓名:'账号新名',学号:'新学号'};
test('seat profiles use current account identity and refresh edits without rewriting booking snapshots',()=>{
 const input=structuredClone(booking);
 assert.deepEqual(placeProfilePlan([place],[booking],[account]),[{rowId:'seat',fields:{姓名:'账号新名',学号:'新学号'}}]);
 assert.equal(placeProfilePlan([{...place,姓名:'账号新名',学号:'新学号'}],[booking],[account]).length,0);
 assert.deepEqual(booking,input);
 assert.equal(placeProfilePlan([place],[booking],[{...account,真实姓名:'再次修改'}])[0].fields.姓名,'再次修改');
});
test('vacant and cancelled seats clear identity; pending leave retains it; unknown accounts never use historical identity',()=>{
 const displayed={...place,姓名:'旧名',学号:'旧号'};
 for(const changed of [{...displayed,报名ID:'',报名行ID:'',名额状态:'空闲'},{...displayed,名额状态:'已停用'}])assert.deepEqual(placeProfilePlan([changed],[booking],[account])[0].fields,{姓名:'',学号:''});
 assert.deepEqual(placeProfilePlan([displayed],[{...booking,报名状态:'已请假'}],[account])[0].fields,{姓名:'',学号:''});
 assert.equal(placeProfilePlan([{...place,名额状态:'取消待审批'}],[booking],[account])[0].fields.姓名,'账号新名');
 assert.deepEqual(placeProfilePlan([displayed],[booking],[])[0].fields,{姓名:'',学号:''});
});
test('duplicate and mismatched identities stop before producing writes',()=>{
 assert.throws(()=>placeProfilePlan([place],[booking],[account,account]));
 assert.throws(()=>placeProfilePlan([place],[booking,booking],[account]));
 assert.throws(()=>placeProfilePlan([place],[{...booking,_id:'wrong'}],[account]));
 assert.throws(()=>placeProfilePlan([place],[{...booking,活动ID:'wrong'}],[account]));
 assert.throws(()=>placeProfilePlan([place],[],[account]));
});
test('worker reads only approved account fields, verifies writes and makes failures retryable',async()=>{
 const seats=[{...place}],writes=[],columns=['姓名','学号'].map(name=>({name,type:'text'}));
 const base={getMetadata:async()=>({tables:[{name:PLACE_TABLE,columns}]}),listRows:async table=>structuredClone(table===PLACE_TABLE?seats:[booking]),updateRow:async(table,id,fields)=>{writes.push({table,id,fields});Object.assign(seats[0],fields);}};
 const identity={query:async sql=>{assert.match(sql,/SELECT `账号ID`, `真实姓名`, `学号`/);assert.doesNotMatch(sql,/SELECT \*/);return [account];}};
 assert.equal((await syncPlaceProfiles(base,identity)).changed,1);
 assert.equal(writes[0].table,PLACE_TABLE);assert.equal((await syncPlaceProfiles(base,identity)).changed,0);
 const before=writes.length;
 await assert.rejects(syncPlaceProfiles(base,{query:async()=>{throw Error('offline');}}));assert.equal(writes.length,before);
 await assert.rejects(syncPlaceProfiles(base,{query:async()=>Object.assign([account],{readMeta:{truncated:true}})}));
 columns.pop();assert.equal((await syncPlaceProfiles(base,identity)).skipped,true);
 assert.notEqual(PLACE_TABLE,REGISTRATION_TABLE);
});
