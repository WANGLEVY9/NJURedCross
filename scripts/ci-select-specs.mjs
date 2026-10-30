// Choose the browser specs a pull request actually needs.
//
// main 上的推送与每日全量仍跑全部用例；这里只用于给 PR 一个更快的反馈：按改动
// 路径挑出受影响的用例文件。规则刻意保守——只要碰到共享层、后端或改动面过大，
// 就返回空（调用方按"全量"处理），宁可多跑也不漏跑。
//
// Usage: node scripts/ci-select-specs.mjs < changed-files.txt
//        空输出 = 跑全量；否则输出 spec 文件相对路径（每行一个）。
const changed = (await new Promise((resolve) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { text += chunk; });
  process.stdin.on('end', () => resolve(text));
})).split('\n').map(line => line.trim()).filter(Boolean);

/** 这些路径影响整个前端或整个请求链路，任何改动都不做裁剪。 */
const BROAD = [
  /^server\.js$/,
  /^package(-lock)?\.json$/,
  /^lib\/http\//,
  /^lib\/cache\//,
  /^lib\/seatable/,
  /^public\/index\.html$/,
  /^public\/app\/boot\.js$/,
  /^public\/app\/main\.js$/,
  /^public\/app\/core\//,
  /^public\/app\/ui\//,
  /^public\/styles\//,
  /^tests\/helpers\//,
  /^playwright\.config/,
];

const MAP = [
  [/^(public\/app\/portal\/pages\/materials|public\/app\/console\/pages\/materials|public\/app\/shared\/material|lib\/materials\/|lib\/reimbursements\/)/, /^(materials|reimbursement)/],
  [/^(public\/app\/console\/pages\/activity|public\/app\/shared\/activity|lib\/events\/)/, /^(activity|workflow|events|ordinary)/],
  [/^(public\/app\/portal\/pages\/(warmth|morning)|public\/app\/console\/pages\/community|lib\/community\/)/, /^(community|morning|warmth)/],
  [/^(public\/app\/portal\/pages\/(me|me-)|public\/app\/portal\/member)/, /^(me|member)/],
  [/^(public\/app\/portal\/blood|public\/app\/portal\/booking|public\/app\/portal\/pages\/blood)/, /^(blood|booking|calendar)/],
  [/^(lib\/identity\/|public\/app\/portal\/pages\/(login|register|change-password))/, /^(login|session|console-access|auth)/],
  [/^(public\/app\/portal\/pages\/outreach|public\/app\/console\/pages\/outreach|lib\/outreach\/)/, /^(outreach|showcase)/],
  [/^(public\/app\/portal\/pages\/events|public\/app\/shared\/events)/, /^(events|activity)/],
];

const specs = new Set();
let broad = false;
for (const file of changed) {
  if (BROAD.some(pattern => pattern.test(file))) { broad = true; break; }
  for (const [source, target] of MAP) {
    if (source.test(file)) specs.add(target);
  }
}

// 改动面过大时不做裁剪：PR 之间的合并噪声会让映射不可靠。
if (!broad && (changed.length > 40 || specs.size === 0)) broad = true;

if (broad) process.stdout.write('');
else {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(new URL('../tests/browser/', import.meta.url))).filter(name => name.endsWith('.spec.mjs'));
  const selected = files.filter(name => [...specs].some(pattern => pattern.test(name)));
  process.stdout.write(selected.map(name => `tests/browser/${name}`).join('\n'));
}
