import {test} from 'node:test';
import assert from 'node:assert/strict';
import {latestChallenge} from '../lib/identity/challenges.js';
const date='2026-10-04T00:00:00.000Z';
test('tied timestamps never select an invalid predecessor because of row ordering',()=>{const old={_id:'old',用途:'change:synthetic',创建时间:date,状态:'已失效'},fresh={...old,_id:'new',状态:'待使用'};for(const rows of [[old,fresh],[fresh,old]])assert.equal(latestChallenge(rows,'change:synthetic').row._id,'new');});
test('multiple pending rows at newest timestamp and invalid timestamps fail closed',()=>{const row={用途:'register',创建时间:date,状态:'待使用'};assert.equal(latestChallenge([row,{...row}],'register').ambiguous,true);assert.equal(latestChallenge([{...row,创建时间:'invalid'}],'register').ambiguous,true);});
test('older pending code cannot replace newer used code or another purpose',()=>{const row={用途:'register',创建时间:date,状态:'已消费'};assert.equal(latestChallenge([row,{用途:'register',创建时间:'2026-10-03T00:00:00Z',状态:'待使用'}],'register').row,row);assert.equal(latestChallenge([row],'reset').row,undefined);assert.equal(latestChallenge([row,{...row,创建时间:'invalid',状态:'已失效'}],'register').row,row);});
