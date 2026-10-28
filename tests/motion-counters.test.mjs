import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/app/core/motion.js', import.meta.url), 'utf8');
// 只截取计数相关的一段：runCounter / sharedCounterObserver / countOnVisible。
const slice = source
  .slice(source.indexOf('function runCounter'), source.indexOf('export function captureRects'))
  .replace(/^export /gm, '');

class FakeObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    this.disconnected = false;
    FakeObserver.instances.push(this);
  }
  observe(node) { this.targets.add(node); }
  unobserve(node) { this.targets.delete(node); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
  enter(node) { this.callback([{ target: node, isIntersecting: true }]); }
  enterHidden(node) { this.callback([{ target: node, isIntersecting: false }]); }
}

function fixture({ withObserver = true } = {}) {
  const rolled = [];
  const counter = { qsa: (_selector, root) => root.nodes, countTo: (node, target) => rolled.push([node.id, target]) };
  const window = withObserver ? { IntersectionObserver: FakeObserver } : {};
  const context = vm.createContext({
    ...counter,
    window,
    IntersectionObserver: withObserver ? FakeObserver : undefined,
    Intl,
  });
  vm.runInContext(`${slice};globalThis.countOnVisible = countOnVisible;`, context);
  FakeObserver.instances = [];
  return { countOnVisible: context.countOnVisible, rolled };
}

const node = (id, count, decimals = 0) => ({ id, dataset: { count: String(count), countDecimals: String(decimals) } });

test('进入视口才滚动数值，且滚动后取消观察', () => {
  const { countOnVisible, rolled } = fixture();
  const a = node('a', 40);
  const b = node('b', 491);
  const stop = countOnVisible({ nodes: [a, b] });
  const [observer] = FakeObserver.instances;
  assert.equal(observer.targets.size, 2, '两个指标都应被观察');
  assert.deepEqual(rolled, [], '还没进入视口时不应改动数值');
  assert.equal(observer.options.threshold > 0, true);
  observer.enterHidden(a);
  assert.deepEqual(rolled, [], '不可见的节点不计');
  observer.enter(a);
  assert.deepEqual(rolled, [['a', 40]]);
  assert.equal(observer.targets.has(a), false, '滚完就 unobserve，避免重复动画');
  assert.equal(typeof stop, 'function');
});

test('多次渲染共用同一个观察者，避免翻页筛选项下泄漏', () => {
  const { countOnVisible } = fixture();
  countOnVisible({ nodes: [node('a', 1)] });
  countOnVisible({ nodes: [node('b', 2)] });
  countOnVisible({ nodes: [node('c', 3)] });
  assert.equal(FakeObserver.instances.length, 1, '整个会话只应创建一个 IntersectionObserver');
  assert.equal(FakeObserver.instances[0].targets.size, 3);
});

test('重复观察同一节点不会导致它被漏计', () => {
  const { countOnVisible, rolled } = fixture();
  const a = node('a', 7);
  countOnVisible({ nodes: [a] });
  countOnVisible({ nodes: [a] });
  const [observer] = FakeObserver.instances;
  assert.equal(observer.targets.size, 1);
  observer.enter(a);
  assert.deepEqual(rolled, [['a', 7]], '同一节点只滚一次');
});

test('没有 IntersectionObserver 时直接落到终值', () => {
  const { countOnVisible, rolled } = fixture({ withObserver: false });
  countOnVisible({ nodes: [node('a', 5), node('b', 6)] });
  assert.deepEqual(rolled, [['a', 5], ['b', 6]]);
  assert.equal(FakeObserver.instances.length, 0);
});

test('区域内没有计数节点时不建观察者', () => {
  const { countOnVisible } = fixture();
  countOnVisible({ nodes: [] });
  assert.equal(FakeObserver.instances.length, 0);
});
