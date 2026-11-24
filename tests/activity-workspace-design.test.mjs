import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async path => readFile(new URL(path, root), 'utf8');

test('activity management loads one scoped design baseline', async () => {
  const [html, css] = await Promise.all([
    read('public/index.html'),
    read('public/styles/activity-workspace-redesign.css'),
  ]);
  assert.match(html, /href="\/styles\/activity-workspace-redesign\.css"[^>]*data-surface="console"/);
  assert.match(css, /@scope \(\.activity-workspace-redesign\)/);
  assert.match(css, /--workspace-control-h: 40px/);
  assert.match(css, /font-size: var\(--fs-body\)/);
  assert.match(css, /font-family: var\(--font-sans\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /font-size:\s*10px/);
});

test('directory cards share the plaza category palette and status stays a readable chip', async () => {
  const [css, tokens, plaza] = await Promise.all([
    read('public/styles/activity-workspace-redesign.css'),
    read('public/styles/tokens.css'),
    read('public/styles/events-plaza.css'),
  ]);
  assert.match(css, /\.activity-v2-card \{[^}]*--activity-card-bg: color-mix\(in srgb, var\(--category-label-bg/s);
  assert.match(css, /\.activity-v2-card\[aria-pressed=true\] \{[^}]*border-color: var\(--accent\)[^}]*box-shadow: inset 0 0 0 1px/s);
  assert.doesNotMatch(css, /inset 3px 0 0/);
  assert.doesNotMatch(css, /border-left: 2px/);
  assert.match(css, /\.activity-v2-badge \{[^}]*min-height: 22px/s);
  assert.match(css, /\.activity-v2-heading li \{[^}]*min-width: 56px/s);
  assert.doesNotMatch(css, /content: attr\(data-category\)/);
  for (const category of ['主席团专项', '博爱中心', '生命中心', '综事中心', '一加助残专项', '献血车专项', '排班专项']) {
    const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const token = tokens.match(new RegExp(`\\[data-category='${escaped}'\\][^{]*\\{([^}]+)\\}`))?.[1];
    const plazaRule = plaza.match(new RegExp(`\\[data-category='${escaped}'\\][^{]*\\{([^}]+)\\}`))?.[1];
    assert.ok(token && plazaRule, `${category} should have a shared palette`);
    assert.equal(token.trim().toLowerCase(), plazaRule.trim().toLowerCase());
  }
});

test('desktop directory width is resizable by pointer, keyboard and persisted preference', async () => {
  const [page, css, module] = await Promise.all([
    read('public/app/console/pages/activity-workspace-page.js'),
    read('public/styles/activity-workspace-redesign.css'),
    read('public/app/console/activity-directory-width.js'),
  ]);
  assert.match(page, /bindActivityDirectoryWidth\(\{workspace,directory,handle:directoryResizer,desktop\}/);
  assert.match(page, /role:'separator'/);
  assert.match(page, /aria-orientation':'vertical'/);
  assert.match(page, /directoryWidth\?\.sync\(\)/);
  assert.match(css, /clamp\(260px, var\(--activity-directory-width, 300px\), 460px\)/);
  assert.match(css, /\.activity-v2-directory-resizer\[hidden\][\s\S]*display: none/);
  assert.match(module, /prefs\.set\(KEY, width\)/);
  assert.match(module, /ArrowLeft: -STEP, ArrowRight: STEP, Home: -Infinity, End: Infinity/);
  assert.match(module, /new ResizeObserver/);
});

test('final hours columns keep readable type, stable classes and aligned review controls', async () => {
  const [css, source] = await Promise.all([
    read('public/styles/activity-workspace-redesign.css'),
    read('public/app/console/pages/activity-final-hours-workspace.js'),
  ]);
  assert.match(source, /const columnClass=key=>`activity-final-hours-col-\$\{key\}`/);
  assert.match(source, /class:'activity-final-hours-col-review'/);
  assert.match(css, /\.activity-v2 \.activity-final-hours-table>table,[\s\S]*min-width: 1630px/);
  assert.match(css, /\.activity-v2 \.activity-final-hours-table td \{[^}]*font-size: var\(--fs-body\)/s);
  assert.match(css, /\.activity-v2 \.activity-final-hours-table \.activity-final-hours-col-review \{[^}]*vertical-align: middle/s);
  assert.match(css, /\.activity-final-hours-col-review>\.btn \{[^}]*white-space: nowrap/s);
  assert.match(css, /\.activity-final-hours-col-studentId/);
});

test('workspace marks one primary action and separates destructive menu actions', async () => {
  const [draft, page, leave] = await Promise.all([
    read('public/app/console/pages/activity-draft-workspace.js'),
    read('public/app/console/pages/activity-workspace-page.js'),
    read('public/app/console/pages/activity-leave-review.js'),
  ]);
  assert.match(draft, /button\(\{label:'预览并提交',variant:'primary'/);
  assert.match(page, /label:'删除活动',data:\{danger:'true'\}/);
  assert.match(page, /label:'取消活动',data:\{danger:'true'\}/);
  assert.match(leave, /button\(\{label:'批量请假审批',size:'sm',iconName:'checkCheck'/);
});

test('activity directory uses explicit list semantics and category metadata', async () => {
  const source = await read('public/app/console/pages/activity-workspace-page.js');
  assert.match(source, /activity-v2 activity-workspace-redesign/);
  assert.match(source, /class:'activity-v2-list',role:'list'/);
  assert.match(source, /role:'listitem'/);
  assert.match(source, /data:\{category:'献血车专项',region:'nanjing'\}/);
  assert.match(source, /aria:\{pressed:String\(row\.id===selected\)\}/);
});

test('phone layout uses one column, 44px-safe controls and a scrollable action row', async () => {
  const css = await read('public/styles/activity-workspace-redesign.css');
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /\.activity-v2 \.activity-draft-toolbar \{[^}]*overflow-x: auto/s);
  assert.match(css, /\.activity-v2 \.activity-draft-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /overscroll-behavior-x: contain/);
});

test('people pickers keep checkbox semantics while gaining search and selected count', async () => {
  const source = await read('public/app/console/pages/activity-project-people.js');
  const css = await read('public/styles/activity-workspace-redesign.css');
  assert.match(source, /class:'input activity-people-search',type:'search'/);
  assert.match(source, /class:'t-caption activity-people-count'/);
  assert.match(source, /h\('input',\{type:'checkbox'/);
  assert.match(source, /class:'activity-person-choice'/);
  assert.match(css, /\.activity-people-tools/);
  assert.match(css, /\.activity-responsible-choices \{[\s\S]*display: grid/);
});

test('phone position rows become labelled cards without a horizontal table', async () => {
  const [source, css] = await Promise.all([
    read('public/app/console/pages/activity-draft-workspace.js'),
    read('public/styles/activity-workspace-redesign.css'),
  ]);
  assert.match(source, /const headings=\['岗位与人数','日期与时间','地点与工作','时长（小时）','操作'\]/);
  assert.match(source, /headings\.map\(label=>h\('td',\{data:\{label\}\}\)\)/);
  assert.match(css, /\.activity-v2 \.activity-draft-table thead \{\s*display: none/);
  assert.match(css, /td\[data-label\]::before/);
});
