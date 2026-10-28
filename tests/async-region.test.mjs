import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/app/console/lib.js', import.meta.url), 'utf8');
function fixture() {
  const node = () => ({ children: [], attrs: {}, append(...items) { this.children.push(...items); }, setAttribute(key,value) { this.attrs[key]=value; }, removeAttribute(key) { delete this.attrs[key]; }, querySelector() { return null; } });
  const counted = [];
  const box = { h: (_tag,_attrs,...children) => { const n=node();n.append(...children);return n; }, clear: n => { n.children=[]; }, skeletonRows: () => 'skeleton', countOnVisible: (root) => { counted.push(root); }, errorState: () => 'error' };
  vm.createContext(box);
  vm.runInContext(source.slice(source.indexOf('export function asyncRegion'),source.indexOf('export const skeletons')).replace('export function','function')+';globalThis.region=asyncRegion;',box);
  box.region.counted = counted;
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

test('initial region load allows cached data and later refresh explicitly bypasses it',async()=>{
 const loads=[],region=fixture();
 const slot=region({lazy:true,load:options=>{loads.push(options.fresh);return 'data';},render:data=>data});
 await slot.reload();await slot.reload();
 assert.deepEqual(loads,[false,true]);
});

test('每次渲染后都重新点燃数值指标计数（否则指标永远停在 0）', async () => {
  // 回归背景：render 产出的 [data-count] 靠 countOnVisible 才滚动到目标值；
  // 这个调用一度从 asyncRegion 里丢失，导致「展示条目 / 已接入数据表」等恒显示 0。
  const region = fixture();
  const slot = region({ lazy: true, load: () => Promise.resolve('a'), render: () => 'panel' });
  assert.equal(region.counted.length, 0, '只是构建结构、还没加载时不该点火');
  await slot.reload();
  assert.deepEqual(region.counted, [slot], '首屏加载完成后要在该槽位内点燃计数');
  await slot.reload();
  assert.equal(region.counted.length, 2, '刷新（数据变了）要按新目标值重新计数');
  slot.redraw();
  assert.equal(region.counted.length, 3, '重绘（切换筛选/排序）同样要重新计数');
});

test('加载失败的分支不去点亮不存在的指标', async () => {
  const region = fixture();
  const slot = region({ lazy: true, load: () => Promise.reject(new Error('boom')), render: () => 'panel' });
  await slot.reload();
  assert.equal(region.counted.length, 0);
});


test('a slower earlier refresh cannot overwrite the newer page records', async () => {
  const region=fixture();const waiting=[];
  const slot=region({lazy:true,load:()=>new Promise(resolve=>waiting.push(resolve)),render:data=>data});
  const old=slot.reload(), fresh=slot.reload();
  waiting[1]('new');await fresh;waiting[0]('old');await old;
  assert.equal(slot.children[0],'new');assert.equal(slot.attrs['aria-busy'],undefined);
});
