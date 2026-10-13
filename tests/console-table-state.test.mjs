import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../public/app/console/table-state.js', import.meta.url),
  'utf8',
);

function fixture(search = '') {
  const patches = [];
  const box = {
    location: { search },
    URLSearchParams,
    patchQuery(changes) {
      patches.push(JSON.parse(JSON.stringify(changes)));
    },
  };

  vm.createContext(box);
  vm.runInContext(
    source
      .replace(/^import .*;\r?\n/m, '')
      .replace('export function tableStateOptions', 'function tableStateOptions'),
    box,
  );

  return {
    box,
    patches,
    options(extra = {}) {
      return box.tableStateOptions({
        prefix: 'publicSubmissions',
        sortKeys: ['title', 'submittedAt'],
        clearTargets: ['submission', 'campaign'],
        ...extra,
      });
    },
  };
}

test('restores search text and valid sorting', () => {
  const f = fixture(
    '?publicSubmissionsQuery=合成搜索' +
    '&publicSubmissionsSort=submittedAt' +
    '&publicSubmissionsDirection=desc',
  );
  const options = f.options();
  assert.equal(options.initialQuery, '合成搜索');
  assert.equal(options.initialSort.key, 'submittedAt');
  assert.equal(options.initialSort.direction, 'desc');
});

test('invalid saved sorting falls back to the default', () => {
  for (const search of [
    '?publicSubmissionsSort=unknown&publicSubmissionsDirection=asc',
    '?publicSubmissionsSort=title&publicSubmissionsDirection=invalid',
    '?publicSubmissionsSort=title',
  ]) {
    const f = fixture(search);
    const fallback = { key: 'title', direction: 'asc' };
    const options = f.options({ defaultSort: fallback });
    assert.equal(options.initialSort, fallback);
  }
});

test('ordinary visits start with empty search and no sorting', () => {
  const options = fixture().options();
  assert.equal(options.initialQuery, '');
  assert.equal(options.initialSort, null);
});

test('state changes save search and sorting and clear old task targets', () => {
  const f = fixture();
  f.options().onStateChange({
    query: '新的合成搜索',
    sort: { key: 'title', direction: 'asc' },
  });
  assert.deepEqual(f.patches, [{
    publicSubmissionsQuery: '新的合成搜索',
    publicSubmissionsSort: 'title',
    publicSubmissionsDirection: 'asc',
    submission: null,
    campaign: null,
  }]);
});

test('clearing search and invalid sorting produces removable query values', () => {
  const f = fixture();
  f.options().onStateChange({
    query: '',
    sort: { key: 'unknown', direction: 'desc' },
  });
  assert.deepEqual(f.patches, [{
    publicSubmissionsQuery: '',
    publicSubmissionsSort: null,
    publicSubmissionsDirection: null,
    submission: null,
    campaign: null,
  }]);
});

test('separate lists read their own state from the current address', () => {
  const f = fixture('?publicSubmissionsQuery=公众投稿');
  assert.equal(f.options().initialQuery, '公众投稿');

  f.box.location.search =
    '?communityInterestsQuery=参加登记' +
    '&communityInterestsSort=nickname' +
    '&communityInterestsDirection=asc';

  const options = f.options({
    prefix: 'communityInterests',
    sortKeys: ['nickname'],
    clearTargets: ['interest'],
  });
  assert.equal(options.initialQuery, '参加登记');
  assert.equal(options.initialSort.key, 'nickname');

  options.onStateChange({ query: '新登记搜索', sort: null });
  assert.deepEqual(f.patches[0], {
    communityInterestsQuery: '新登记搜索',
    communityInterestsSort: null,
    communityInterestsDirection: null,
    interest: null,
  });
});