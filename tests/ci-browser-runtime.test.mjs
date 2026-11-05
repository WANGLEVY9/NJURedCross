import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('all browser CI jobs use the locked Playwright image without apt or download fallback',async()=>{
 const workflow=(await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
 const version=lock.packages['node_modules/@playwright/test'].version;
 for(const job of ['browser','visual','cross-browser']){
  const start=workflow.indexOf(`  ${job}:\n`);assert.ok(start>=0);
  const tail=workflow.slice(start+1),next=tail.search(/\n {2}[a-z][\w-]*:\n/);
  const block=next<0?tail:tail.slice(0,next);
  assert.ok(block.includes(`image: mcr.microsoft.com/playwright:v${version}-noble`),`${job} image must match the lockfile`);
  assert.ok(block.includes('HOME: /root'),`${job} must retain Firefox-compatible HOME`);
  assert.ok(block.includes('timeout-minutes: 2\n        run: node scripts/check-browser-runtime.mjs'),`${job} must check its preinstalled runtime with a bounded step`);
  assert.doesNotMatch(block,/run:.*(?:playwright install|apt-get|apt install)/);
  assert.ok(block.includes('npm ci'),`${job} must install project dependencies`);
  assert.ok(block.includes('npm run test:browser'),`${job} must still run the tests`);
 }
});

test('missing or cancelled verification continues to block deployment',async()=>{
 const workflow=(await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 assert.match(workflow,/needs: \[verify, release-tests, browser, cross-browser, timezones, coverage\]/);
 assert.ok(workflow.includes('assert not failed and not cancelled'));
 assert.match(workflow,/name: Deploy main to production\n {4}needs: quality/);
});
