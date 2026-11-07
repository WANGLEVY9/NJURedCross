import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);

const start = source.indexOf('export function resolveReviewCategory');
assert.ok(start >= 0, '未找到 resolveReviewCategory 定义');
const end = source.indexOf('\n}', start) + 2;
const declaration = source.slice(start, end).replace(/^export /, '');

const box = vm.createContext({});
vm.runInContext(declaration, box);
const resolveReviewCategory = box.resolveReviewCategory;

test('审核栏目：服务端的「推文类别」优先于入口传入的内容类型', () => {
  assert.equal(resolveReviewCategory('红会新闻', '文字稿件'), '红会新闻');
  assert.equal(resolveReviewCategory('活动总结', ''), '活动总结');
});

test('审核栏目：服务端缺栏目时回退到入口值（公众投稿标签页带的是真栏目）', () => {
  assert.equal(resolveReviewCategory('', '活动总结'), '活动总结');
  assert.equal(resolveReviewCategory(undefined, '心灵慢车'), '心灵慢车');
  assert.equal(resolveReviewCategory(null, '小红帮推'), '小红帮推');
});

test('审核栏目：两侧都取不到时返回空串，由界面显示「未配置」', () => {
  assert.equal(resolveReviewCategory('', ''), '');
  assert.equal(resolveReviewCategory(undefined, undefined), '');
  assert.equal(resolveReviewCategory(null, null), '');
});

test('审核栏目：首尾空白被裁掉，避免带空格查不到对接人', () => {
  assert.equal(resolveReviewCategory('   ', '  活动总结 '), '活动总结');
  assert.equal(resolveReviewCategory(' 红会新闻 ', '文字稿件'), '红会新闻');
});

test('刷新后仍守住：看板不再把 item.type（内容类型）当栏目传给审核抽屉', () => {
  assert.ok(
    !/reviewFlow:\s*\{\s*contentId:\s*item\.id,\s*category:\s*item\.type/.test(source),
    '看板审核入口又把内容类型当栏目了',
  );
  assert.ok(
    /reviewFlow\.category = resolveReviewCategory\(chain\?\.category/.test(source),
    '审核链返回后没有用 resolveReviewCategory 定稿栏目',
  );
});
