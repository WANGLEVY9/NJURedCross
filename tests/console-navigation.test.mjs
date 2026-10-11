import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSOLE_SECTIONS,consoleSection,visibleConsoleSections } from '../public/app/console/navigation.js';

test('seven ordered management sections share stable routes',()=>{
  assert.deepEqual(CONSOLE_SECTIONS.map(s=>s.label),['总览','管理员中心','活动管理','宣传管理','内建管理','物资管理','红会语录墙']);
  assert.equal(new Set(CONSOLE_SECTIONS.map(s=>s.path)).size,7);
});
test('legacy tools highlight their owning section and do not match unrelated prefixes',()=>{
  assert.equal(consoleSection('/console/settings').path,'/console/admin');
  assert.equal(consoleSection('/console/data').path,'/console/admin');
  assert.equal(consoleSection('/console/volunteers').path,'/console/events');
  assert.equal(consoleSection('/console/workflow').path,'/console/events');
  assert.equal(consoleSection('/console/events-invalid'),null);
});
test('limited administrators only see their assigned sections',()=>{
  assert.deepEqual(visibleConsoleSections(scope=>scope==='events').map(s=>s.label),['总览','管理员中心','活动管理']);
  assert.equal(visibleConsoleSections(scope=>scope==='community').some(s=>s.path==='/console/quotes'),true);
});
