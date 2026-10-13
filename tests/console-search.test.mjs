import test from 'node:test';
import assert from 'node:assert/strict';
import { searchBusinessRecords } from '../lib/console-search.js';

function record(id, view = 'materials') {
  return {
    id,
    title: `合成记录 ${id}`,
    detail: '合成描述',
    view,
    target: { kind: 'inventory', id },
  };
}

test('short queries do not read any business source', async () => {
  let reads = 0;
  for (const query of ['', ' ', '合', undefined]) {
    const result = await searchBusinessRecords({
      query,
      permissions: ['materials'],
      providers: [{
        scope: 'materials',
        load: () => { reads++; return { items: [] }; },
      }],
    });
    assert.deepEqual(result.items, []);
  }
  assert.equal(reads, 0);
});

test('unauthorized modules are never read', async () => {
  let unauthorizedReads = 0;
  const result = await searchBusinessRecords({
    query: '合成',
    permissions: ['materials'],
    providers: [
      {
        scope: 'materials',
        load: async () => ({ items: [record('allowed')] }),
      },
      {
        scope: 'community',
        load: async () => {
          unauthorizedReads++;
          return { items: [record('private', 'community')] };
        },
      },
    ],
  });
  assert.equal(unauthorizedReads, 0);
  assert.deepEqual(result.items.map((item) => item.id), ['allowed']);
});

test('matching is case insensitive and preserves the detail target', async () => {
  const result = await searchBusinessRecords({
    query: ' SYNTHETIC ',
    permissions: ['materials'],
    providers: [{
      scope: 'materials',
      load: async () => ({ items: [record('synthetic-1')] }),
    }],
  });
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0].target, {
    kind: 'inventory',
    id: 'synthetic-1',
  });
});

test('a failed source does not hide successful results', async () => {
  const result = await searchBusinessRecords({
    query: '合成',
    permissions: ['materials', 'outreach'],
    providers: [
      {
        scope: 'materials',
        load: async () => ({ items: [record('visible')] }),
      },
      {
        scope: 'outreach',
        load: async () => { throw new Error('合成读取失败'); },
      },
    ],
  });
  assert.deepEqual(result.items.map((item) => item.id), ['visible']);
  assert.deepEqual(result.unavailable, ['outreach']);
});

test('invalid records and mismatched module views are excluded', async () => {
  const result = await searchBusinessRecords({
    query: '合成',
    permissions: ['materials'],
    providers: [{
      scope: 'materials',
      load: async () => ({
        items: [
          record('valid'),
          record('wrong-view', 'community'),
          { ...record('blank-title'), title: '' },
          { ...record('blank-id'), id: ' ' },
          null,
        ],
      }),
    }],
  });
  assert.deepEqual(result.items.map((item) => item.id), ['valid']);
});

test('duplicate results are removed before applying the limit', async () => {
  const result = await searchBusinessRecords({
    query: '合成',
    permissions: ['materials'],
    limit: 2,
    providers: [{
      scope: 'materials',
      load: async () => ({
        items: [
          record('first'),
          record('first'),
          record('second'),
          record('third'),
        ],
      }),
    }],
  });
  assert.deepEqual(result.items.map((item) => item.id), ['first', 'second']);
  assert.equal(result.truncated, true);
});

test('incomplete source coverage is reported', async () => {
  const result = await searchBusinessRecords({
    query: '合成',
    permissions: ['materials'],
    providers: [{
      scope: 'materials',
      load: async () => ({
        items: [record('visible')],
        complete: false,
      }),
    }],
  });
  assert.equal(result.truncated, true);
});

test('malformed source responses are reported as unavailable', async () => {
  const result = await searchBusinessRecords({
    query: '合成',
    permissions: ['materials'],
    providers: [{
      scope: 'materials',
      load: async () => ({ items: null }),
    }],
  });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.unavailable, ['materials']);
});