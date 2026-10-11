import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedServiceHours} from '../public/app/shared/activity-templates.js';
test('service duration suggestions parse explicit ranges and reject ambiguous or overnight values',()=>{assert.equal(suggestedServiceHours('16-18点'),2);assert.equal(suggestedServiceHours('上午 11~15点'),4);assert.equal(suggestedServiceHours('10:15至12:45'),2.5);for(const slot of ['上午','23-02','25-26','10:70-12:00'])assert.equal(suggestedServiceHours(slot),null);});
