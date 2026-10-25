import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeProfileFields} from '../lib/identity/profile-merge.js';
test('remote changes refresh unchanged local values',()=>assert.deepEqual(mergeProfileFields({local:{phone:'old'},remote:{phone:'new'},baseline:{phone:'old'}}),{pull:{phone:'new'},push:{},conflicts:{}}));
test('simultaneous edits preserve both values without writing',()=>assert.deepEqual(mergeProfileFields({local:{phone:'mine'},remote:{phone:'theirs'},baseline:{phone:'old'},pending:{phone:'mine'}}),{pull:{},push:{},conflicts:{phone:{local:'mine',remote:'theirs'}}}));
test('pending edits write only when remote has not changed',()=>assert.deepEqual(mergeProfileFields({local:{phone:'mine'},remote:{phone:'old'},baseline:{phone:'old'},pending:{phone:'mine'}}).push,{phone:'mine'}));
test('unknown history never overwrites differing nonempty data',()=>assert.equal(Object.keys(mergeProfileFields({local:{phone:'mine'},remote:{phone:'theirs'}}).conflicts).length,1));

test('first verified binding preserves explicit pending user edits before baseline exists',()=>assert.deepEqual(mergeProfileFields({local:{campus:'仙林'},remote:{campus:'鼓楼'},pending:{campus:'仙林'}}).push,{campus:'仙林'}));
