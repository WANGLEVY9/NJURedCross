import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

/*
 * 运营总览的板块聚合读取。
 *
 * 回归背景：服务端 /api/notifications/overview 把按板块聚合的待办放在
 * `stats.groups` 里（顶层 `items` 仍是平铺明细）。总览页面一度只读顶层
 * `payload.groups`，导致「活动/物资/内容待处理」三个指标恒为 0，
 * 待办队列还会误报「没有待处理的任务」。这里锁定 helper 的两种形状兼容。
 */

const source = await readFile(new URL('../public/app/console/pages/overview.js', import.meta.url), 'utf8');
const slice = source
  .slice(source.indexOf('const boardGroups'), source.indexOf('export default async function overviewPage'))
  .replace(/^const /gm, 'var ');

function load() {
  const context = vm.createContext({});
  vm.runInContext(`${slice};globalThis.boardGroups = boardGroups;globalThis.boardCount = boardCount;`, context);
  return context;
}

const GROUPS = [
  { key: 'materials', label: '物资', count: 10, high: 6, types: ['物资逾期'] },
  { key: 'outreach', label: '宣传', count: 8, high: 0, types: ['内容待审核'] },
  { key: 'community', label: '内建', count: 1, high: 0, types: ['温暖连接待确认'] },
];

test('boardGroups 读取 stats.groups（服务端当前形状）', () => {
  const { boardGroups } = load();
  assert.deepEqual(boardGroups({ ok: true, stats: { total: 19, groups: GROUPS }, items: [] }), GROUPS);
});

test('boardGroups 兼容顶层 groups 旧形状', () => {
  const { boardGroups } = load();
  assert.deepEqual(boardGroups({ ok: true, groups: GROUPS }), GROUPS);
});

test('boardGroups 对缺失或非法形状返回空数组', () => {
  const { boardGroups } = load();
  // 空数组来自 vm 上下文，跨 realm 不参与深比较，按长度断言。
  assert.equal(boardGroups({ ok: true, stats: { total: 0 } }).length, 0);
  assert.equal(boardGroups({ ok: true, groups: null, stats: { groups: 'oops' } }).length, 0);
  assert.equal(boardGroups(null).length, 0);
  assert.equal(boardGroups(undefined).length, 0);
});

test('boardGroups 优先使用顶层 groups（万一上游改回顶层）', () => {
  const { boardGroups } = load();
  const top = [{ key: 'outreach', count: 3 }];
  assert.deepEqual(boardGroups({ groups: top, stats: { groups: GROUPS } }), top);
});

test('boardCount 按板块 key 汇总：活动/物资/内容三项与待办总数一致', () => {
  const { boardGroups, boardCount } = load();
  const groups = boardGroups({ ok: true, stats: { total: 19, groups: GROUPS } });
  assert.equal(boardCount(groups, ['events']), 0);
  assert.equal(boardCount(groups, ['materials']), 10);
  assert.equal(boardCount(groups, ['outreach', 'community']), 9);
  assert.equal(
    boardCount(groups, ['events']) + boardCount(groups, ['materials']) + boardCount(groups, ['outreach', 'community']),
    19,
  );
});

test('boardCount 忽略未知 key；调用方保证 key 不重复', () => {
  const { boardCount } = load();
  assert.equal(boardCount(GROUPS, ['nope']), 0);
  assert.equal(boardCount([], ['outreach']), 0);
  // 同一 key 传两次会累加两次 —— 现网调用点均为互不重复的 key 列表，这里只记录行为。
  assert.equal(boardCount(GROUPS, ['outreach', 'outreach']), 16);
});
