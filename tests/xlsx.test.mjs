import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hoursWorkbook} from '../lib/events/xlsx.js';
test('XLSX contains ten-column inline text, numeric hours, and preserved student identifiers',()=>{const buffer=hoursWorkbook(['学号','姓名','服务时长'],[{学号:'001234567',姓名:'=HYPERLINK("unsafe") & <test>',服务时长:1.5}]);assert.equal(buffer.readUInt32LE(0),0x04034b50);assert.equal(buffer.readUInt32LE(buffer.length-22),0x06054b50);const text=buffer.toString();assert.ok(text.includes('001234567'));assert.ok(text.includes('&amp; &lt;test&gt;'));assert.ok(text.includes('<v>1.5</v>'));assert.ok(!text.includes('<f>'));assert.ok(text.includes('xl/worksheets/sheet1.xml'));});
