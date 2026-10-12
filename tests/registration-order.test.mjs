import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationsNewestFirst} from '../public/app/portal/registration-order.js';

test('records sort by submission time instead of activity date without mutating the response',()=>{
 const records=[{code:'old',date:'2026-12-01',createdAt:'2026-10-01T10:00:00Z'},{code:'new',date:'2026-08-30',createdAt:'2026-10-12T10:00:00Z'}];
 assert.deepEqual(registrationsNewestFirst(records).map(r=>r.code),['new','old']);
 assert.equal(records[0].code,'old');
});
test('managed registration timestamps and legacy insertion order are supported',()=>{
 assert.deepEqual(registrationsNewestFirst([{code:'old',submittedAt:'2026-10-01'},{code:'new',submittedAt:'2026-10-12'}]).map(r=>r.code),['new','old']);
 assert.deepEqual(registrationsNewestFirst([{code:'first'},{code:'second'},{code:'last'}]).map(r=>r.code),['last','second','first']);
});
test('registration time breaks ties within the same activity session',()=>{
 const records=[{code:'first',date:'2026-10-12',slot:'上午',createdAt:'2026-10-01T10:00:00Z'},{code:'last',date:'2026-10-12',slot:'上午',createdAt:'2026-10-02T10:00:00Z'}];
 assert.equal(registrationsNewestFirst(records)[0].code,'last');
});
