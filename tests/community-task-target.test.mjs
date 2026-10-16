import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

for (const page of ['community-legacy', 'community-birthday']) {
  const source = await readFile(
    new URL(`../public/app/console/pages/${page}.js`, import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  function openCommunityTaskTarget(');
  const end = source.indexOf('\n  const tabControl =', start);
  assert.ok(start >= 0 && end > start, `${page} 未找到定位函数`);

  function fixture(query, options = {}) {
    const calls = [];
    const reload = () => {};
    const box = {
      context: { query: new URLSearchParams(query) },
      tab: options.tab || 'interests',
      disposed: options.disposed || false,
      communityTargetHandled: false,
      notify: {
        warning(title) {
          calls.push(['warning', title]);
        },
      },
      shell: {
        refreshTodos() {},
      },
      openInterestDrawer(row) {
        calls.push(['interest', row.id]);
      },
      openSubmissionReviewDrawer(row) {
        calls.push(['submission', row.id]);
      },
    };

    vm.createContext(box);
    vm.runInContext(source.slice(start, end), box);

    return {
      calls,
      run(kind, rows) {
        box.openCommunityTaskTarget(kind, rows, reload);
      },
    };
  }

  const rows = [
    { id: 'birthday-1', program: 'birthday' },
    { id: 'morning-1', program: 'morning' },
  ];

  test(`${page}: interest opens once across refreshes`, () => {
    const f = fixture('interest=birthday-1&program=birthday');
    f.run('interest', rows);
    f.run('interest', rows);
    assert.deepEqual(f.calls, [['interest', 'birthday-1']]);
  });

  test(`${page}: submission opens its matching review`, () => {
    const f = fixture('submission=morning-1&program=morning', {
      tab: 'submissions',
    });
    f.run('submission', rows);
    assert.deepEqual(f.calls, [['submission', 'morning-1']]);
  });

  test(`${page}: ordinary visits do not open a detail`, () => {
    const f = fixture('tab=interests');
    f.run('interest', rows);
    assert.deepEqual(f.calls, []);
  });

  test(`${page}: missing, blank and wrong-program targets warn`, () => {
    for (const query of [
      'interest=missing&program=birthday',
      'interest=&program=birthday',
      'interest=%20%20&program=birthday',
      'interest=morning-1&program=birthday',
    ]) {
      const f = fixture(query);
      f.run('interest', rows);
      assert.deepEqual(f.calls, [
        ['warning', '当前列表未找到对应记录'],
      ]);
    }
  });

  test(`${page}: empty lists warn without opening another record`, () => {
    const f = fixture('interest=birthday-1&program=birthday');
    f.run('interest', []);
    assert.deepEqual(f.calls, [
      ['warning', '当前列表未找到对应记录'],
    ]);
  });

  test(`${page}: inactive and disposed pages do not open details`, () => {
    for (const options of [
      { tab: 'matching' },
      { disposed: true },
    ]) {
      const f = fixture('interest=birthday-1', options);
      f.run('interest', rows);
      assert.deepEqual(f.calls, []);
    }
  });
}