/**
 * 文档里写的脚本必须真实存在。
 *
 * 起因：`docs/UI_DUAL_VIEWPORT_AUDIT_2026-11-24.md` 的复核命令指向 `scripts/.ui-audit-tmp.mjs`，
 * 那是随提交一起被删掉的临时脚本；`docs/TESTING.md` 与 `docs/SUBMISSION_ATTACHMENTS.md` 也还
 * 停留在改名前的 `scripts/.link-check.mjs`（现为 `check-esm-links.mjs`）。这类路径写在行内代码
 * 里，`check:project` 的断链检查只扫 Markdown 链接，扫不到，于是一直没人发现。
 *
 * 这里把「文档提到的 scripts/*.mjs 必须存在」固化成源码守卫：脚本改名或删除时，引用它的文档
 * 会立刻变红，而不是等某个人照着文档执行才失败。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readdir,readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);

/** 只扫 `docs/`：`reports/` 里的历史报告描述的是当时状态，不随代码演进。 */
async function markdownFiles(dir) {
  const entries = await readdir(new URL(dir, root), {withFileTypes: true});
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) files.push(...await markdownFiles(`${dir}${entry.name}/`));
    else if (entry.name.endsWith('.md')) files.push(`${dir}${entry.name}`);
  }
  return files;
}

const SCRIPT_REFERENCE = /scripts\/[\w./-]+\.mjs/g;

test('documentation references only scripts that exist', async () => {
  const files = await markdownFiles('docs/');
  assert.ok(files.length > 0, '未找到任何 docs/ 下的 Markdown 文档');
  const missing = [];
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8');
    for (const match of text.matchAll(SCRIPT_REFERENCE)) {
      const relative = match[0];
      if (existsSync(new URL(relative, root))) continue;
      missing.push(`${file} → ${relative}`);
    }
  }
  assert.deepEqual(missing, [], `文档引用了不存在的脚本：\n${missing.join('\n')}`);
});

test('the dual-viewport audit document points at the committed report generator', async () => {
  const doc = await readFile(new URL('docs/UI_DUAL_VIEWPORT_AUDIT_2026-11-24.md', root), 'utf8');
  assert.match(doc, /node scripts\/ui-audit-report\.mjs/,
    '复核命令必须给出仍在仓库里的生成脚本，而不是已删除的临时脚本');
});
