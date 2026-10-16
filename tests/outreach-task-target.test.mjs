import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);
const start = source.indexOf('  const publicRegion = asyncRegion({');
const end = source.indexOf('\n  });', start);
assert.ok(start >= 0 && end > start, '未找到公众投稿区域');

function fixture(query, { tab = 'public', disposed = false } = {}) {
  const opened = [];
  const notices = [];
  let region;
  const box = {
    context: { query: new URLSearchParams(query) },
    tab,
    disposed,
    submissionTargetHandled: false,
    asyncRegion(options) {
      region = options;
      return options;
    },
    skeletonRows: () => null,
    openReviewDrawer(options) {
      opened.push(options);
    },
    definitionList: (items) => items,
    copyableCode: (value) => value,
    submissionAttachmentsSection: () => null,
    fmt: { fullDateTime: (value) => value },
    notice(message) {
      notices.push(message);
      return message;
    },
    emptyState: (options) => options,
    button: (options) => options,
    dataTable: (options) => options,
    tableStateOptions: () => ({}),
    metricRow: () => null,
    statusFor: (value) => value,
    consoleApi: {
      outreach: {
        publicSubmissions() {
          throw new Error('测试不应加载真实数据');
        },
        reviewStep() {
          throw new Error('打开详情不应提交审核');
        },
      },
    },
    shell: {
      refreshTodos() {
        throw new Error('打开详情不应刷新写入结果');
      },
    },
  };

  vm.createContext(box);
  vm.runInContext(source.slice(start, end + '\n  });'.length), box);

  return {
    opened,
    notices,
    run(submissions) {
      return region.render(
        { submissions, stats: {} },
        { reload: () => {} },
      );
    },
  };
}

const rows = [
  {
    id: 'submission-1',
    title: '合成投稿甲',
    category: '文字稿件',
    status: '待审核',
  },
  {
    id: 'submission-2',
    title: '合成投稿乙',
    category: '文字稿件',
    status: '已通过',
  },
];

test('target opens the matching review without submitting it', () => {
  const f = fixture('tab=public&submission=submission-2');
  f.run(rows);
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].title, '合成投稿乙');
  assert.equal(f.opened[0].reviewFlow.contentId, 'submission-2');
  assert.equal(f.notices.length, 0);
});

test('refresh does not reopen the target', () => {
  const f = fixture('submission=submission-1');
  f.run(rows);
  f.run(rows);
  assert.equal(f.opened.length, 1);
});

test('ordinary visits do not open a review', () => {
  const f = fixture('tab=public');
  f.run(rows);
  assert.equal(f.opened.length, 0);
  assert.equal(f.notices.length, 0);
});

test('missing and blank targets show guidance without opening another row', () => {
  for (const query of [
    'submission=missing',
    'submission=',
    'submission=%20%20',
  ]) {
    const f = fixture(query);
    f.run(rows);
    assert.equal(f.opened.length, 0);
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /没有找到/);
  }
});

test('an empty list still explains a missing target', () => {
  const f = fixture('submission=submission-1');
  f.run([]);
  assert.equal(f.opened.length, 0);
  assert.equal(f.notices.length, 1);
});

test('inactive or disposed pages do not open the target', () => {
  for (const options of [
    { tab: 'board' },
    { disposed: true },
  ]) {
    const f = fixture('submission=submission-1', options);
    f.run(rows);
    assert.equal(f.opened.length, 0);
    assert.equal(f.notices.length, 0);
  }
});