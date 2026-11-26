import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('all top-left brand surfaces use the shared lockup',async()=>{
 const [portal,consoleShell,login,devGate,html]=await Promise.all([
  read('../public/app/portal/shell.js'),
  read('../public/app/console/shell.js'),
  read('../public/app/console/pages/login.js'),
  read('../public/app/portal/pages/development-gate.js'),
  read('../public/index.html'),
 ]);
 for(const source of [portal,consoleShell,login,devGate])assert.match(source,/brandLockup\(/);
 assert.match(portal,/className:'plogo'/);
 assert.match(consoleShell,/className:'nav__brand-text'/);
 assert.match(html,/NJU Red Cross/);
 assert.doesNotMatch(portal,/NJURedCross/);
});

test('brand type uses a clean bilingual sans system and readable tracking',async()=>{
 const css=await read('../public/styles/brand-lockup.css');
 assert.match(css,/"Helvetica Neue", Helvetica, Arial/);
 assert.match(css,/letter-spacing: 0\.055em/);
 assert.match(css,/--brand-lockup-en: 11px/);
 assert.match(css,/"PingFang SC", "Hiragino Sans GB"/);
 assert.doesNotMatch(css,/Times New Roman/);
});
