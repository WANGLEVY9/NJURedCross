import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async path => readFile(new URL(path, root), 'utf8');

test('operations pages share one console-only visual baseline', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles/console-operations-redesign.css'),
  ]);
  assert.match(html, /href="\/styles\/console-operations-redesign\.css"[^>]*data-surface="console"/);
  assert.match(css, /--ops-control-h: 40px/);
  assert.match(css, /font-family: var\(--font-sans\)/);
  assert.match(css, /\.metric__value \{[\s\S]*font-variant-numeric: tabular-nums/);
  assert.match(css, /\.console-operations-redesign \.overview-task>\.ico \{\s*display: none/s);
  assert.match(css, /\.overview-bar__track \{[\s\S]*display: block[\s\S]*width: 100%/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /border-left: [2-9]px/);
  assert.doesNotMatch(css, /font-size:\s*10px/);
});

test('operations page shells opt into the shared baseline', async () => {
  const files = [
    'public/app/console/pages/overview.js',
    'public/app/console/pages/outreach.js',
    'public/app/console/pages/materials.js',
    'public/app/console/pages/community-birthday.js',
    'public/app/console/pages/community-legacy.js',
    'public/app/console/pages/morning.js',
    'public/app/console/pages/audit.js',
    'public/app/console/pages/data.js',
    'public/app/console/pages/volunteers.js',
  ];
  const sources = await Promise.all(files.map(read));
  for (const source of sources) assert.match(source, /console-operations-redesign/);
});

test('overview removes duplicate eyebrows and labels task rows for assistive tech', async () => {
  const source = await read('public/app/console/pages/overview.js');
  assert.doesNotMatch(source, /label: '待办', title: '待处理事项'/);
  assert.doesNotMatch(source, /label: '活动', title: '活动健康'/);
  assert.doesNotMatch(source, /label: '物资', title: '库存与在办'/);
  assert.doesNotMatch(source, /label: '审计', title: '最近操作记录'/);
  assert.match(source, /aria: \{ label: `\$\{group\.label\} \$\{group\.count\} 项待处理，前往处理` \}/);
  assert.match(source, /role: 'meter'/);
  assert.doesNotMatch(source, /class: 'overview-task__rail'/);
});

test('overview distribution bars expose value and compare against the largest board', async () => {
  const source = await read('public/app/console/pages/overview.js');
  assert.match(source, /valuenow: String\(group\.count\)/);
  assert.match(source, /valuemax: String\(max\)/);
  assert.match(source, /valuetext: `\$\{group\.count\} 项，占最多板块 \$\{percent\}%`/);
});
