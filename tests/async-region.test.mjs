import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/app/console/lib.js', import.meta.url), 'utf8');
function fixture() {
  const node = () => ({ children: [], attrs: {}, append(...items) { this.children.push(...items); }, setAttribute(key,value) { this.attrs[key]=value; }, removeAttribute(key) { delete this.attrs[key]; }, querySelector() { return null; } });
  const box = { h: (_tag,_attrs,...children) => { const n=node();n.append(...children);return n; }, clear: n => { n.children=[]; }, skeletonRows: () => 'skeleton', countOnVisible: () => {}, errorState: () => 'error' };
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('export function asyncRegion'),source.indexOf('export const skeletons')).replace('export function','function')+';globalThis.region=asyncRegion;',box);
  return box.region;
}

test('inactive regions are lazy and preserve displayed content while refreshing', async () => {
  const region=fixture(); let calls=0, finish;
  const slot=region({lazy:true,load:()=>{calls++;return calls===1?Promise.resolve('first'):new Promise(resolve=>{finish=resolve;});},render:data=>data});
  assert.equal(calls,0);
  await slot.reload();assert.equal(slot.children[0],'first');
  const refresh=slot.reload();assert.equal(slot.children[0],'first');assert.equal(slot.attrs['aria-busy'],'true');
  finish('second');await refresh;assert.equal(slot.children[0],'second');
});

test('a slower earlier refresh cannot overwrite the newer page records', async () => {
  const region=fixture();const waiting=[];
  const slot=region({lazy:true,load:()=>new Promise(resolve=>waiting.push(resolve)),render:data=>data});
  const old=slot.reload(), fresh=slot.reload();
  waiting[1]('new');await fresh;waiting[0]('old');await old;
  assert.equal(slot.children[0],'new');assert.equal(slot.attrs['aria-busy'],undefined);
});
