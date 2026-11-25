import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';

export const INFRASTRUCTURE_PATTERNS = Object.freeze([
  /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND/i,
  /socket hang up|network (?:error|unreachable)|connection reset|connection refused|timeout waiting/i,
  /browserType\.launch|Failed to launch|Target page, context or browser has been closed/i,
  /Unable to (?:start|connect|fetch)|runner (?:queue|unavailable|disconnected)/i,
  /npm ERR!|ERR_PNPM|Cannot find module|ENOENT.*playwright/i,
  /\bTimeout \d+ms exceeded|Test timeout of \d+ms exceeded|timedOut|interrupted/i,
]);

export const isInfrastructureError = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return INFRASTRUCTURE_PATTERNS.some(pattern => pattern.test(text));
};

export function readJsonReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function collectFailures(report) {
  // A browser shard writes a compact summary; Playwright writes a full JSON
  // report. Both must feed the same Quality gate summary.
  if (Array.isArray(report?.failures)) return report.failures;
  const failures = [];
  const walk = suites => {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            if (!['unexpected', 'failed', 'timedOut', 'interrupted'].includes(result.status)) continue;
            const message = result.error?.message || result.errors?.map(error => error.message || error).join('\n') || '';
            failures.push({
              file: spec.file || suite.file || '',
              line: spec.line || suite.line || 0,
              title: spec.title || suite.title || '',
              project: test.projectName || '',
              message: String(message).split('\n')[0].slice(0, 220),
              infrastructure: ['timedOut', 'interrupted'].includes(result.status) || isInfrastructureError(`${message}\n${result.error?.stack || ''}`),
            });
          }
        }
      }
      walk(suite.suites);
    }
  };
  walk(report?.suites);
  return failures;
}

export function failureSummary(failures) {
  const unique = [...new Map(failures.map(failure => [`${failure.file}:${failure.line}:${failure.title}:${failure.project}:${failure.message}`, failure])).values()];
  return unique.slice(0, 20).map(failure =>
    `- \`${failure.file}${failure.line ? `:${failure.line}` : ''}\`${failure.project ? ` · ${failure.project}` : ''} · ${failure.title}: ${failure.message || 'no error message'} [${failure.infrastructure ? 'infrastructure' : 'assertion'}]`,
  );
}

export function summarizeNeeds(results) {
  const failed = Object.entries(results || {}).filter(([, job]) => job?.result === 'failure').map(([name]) => name);
  const cancelled = Object.entries(results || {}).filter(([, job]) => job?.result === 'cancelled').map(([name]) => name);
  return { failed, cancelled };
}

export function renderQualitySummary(results, reportPaths = []) {
  const { failed, cancelled } = summarizeNeeds(results);
  const failures = reportPaths.flatMap(path => collectFailures(readJsonReport(path)));
  const lines = ['### Quality gate'];
  if (failed.length) lines.push('', '未通过：', ...failed.map(name => `- **${name}**`));
  if (cancelled.length) lines.push('', '未完成（同样不会部署）：', ...cancelled.map(name => `- ${name}`));
  if (!failed.length && !cancelled.length) lines.push('', '全部质量阶段通过。');
  else {
    const cases = failureSummary(failures);
    if (cases.length) lines.push('', '失败用例：', ...cases);
    else lines.push('', '失败用例摘要不可用；请查看对应 browser shard 的 evidence artifact。');
    lines.push('', '确定性断言失败不会自动重跑；修复测试或代码后重跑失败作业。');
  }
  return lines.join('\n');
}

export function commitRange(previous, current, git = () => spawnSync('git', ['log', '--format=%h %s', `${previous}..${current}`], { encoding: 'utf8' })) {
  if (!previous || previous === current) return [];
  const output = git();
  if (output?.status !== 0 || output?.error) return [];
  return String(output?.stdout || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12);
}

export function renderDeploymentReceipt(receipt, baselineCommit) {
  const lines = [
    '### 生产发布回执',
    `- 提交 \`${receipt?.deployedCommit || 'unknown'}\`，校验 ${receipt?.verifiedFiles ?? 'unknown'} 个运行文件（变更 ${receipt?.changedFiles ?? 'unknown'} / 删除 ${receipt?.removedFiles ?? 'unknown'}）`,
    `- 重启后端：${receipt?.restarted ? '是' : '否'}`,
  ];
  const range = commitRange(baselineCommit, receipt?.deployedCommit);
  if (range.length) lines.push('- 本次发布累计包含此前提交：', ...range.map(item => `  - \`${item}\``));
  if (receipt?.bridgeReady === false) lines.push('- ⚠️ 后端就绪慢于等待窗口，部署队列已被强制放行（站点保持可用，但本次冷启动偏慢）');
  if (receipt?.publicHealth === false) lines.push('- ⚠️ 公网健康检查未过：文件与本地服务已核验并保留该版本，请检查 DNS/TLS/nginx/桥接');
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('ci-quality-report.mjs')) {
  const action = process.argv[2];
  if (action === 'quality') {
    const results = JSON.parse(process.argv[3] || '{}');
    const reports = process.argv.slice(4);
    const summary = renderQualitySummary(results, reports);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    const { failed, cancelled } = summarizeNeeds(results);
    process.exitCode = failed.length || cancelled.length ? 1 : 0;
  } else if (action === 'receipt') {
    const [receiptPath, baselineCommit, outputPath] = process.argv.slice(3);
    let receipt = null;
    try {
      const lines = readFileSync(receiptPath, 'utf8').split('\n').filter(line => line.trim());
      receipt = JSON.parse(lines.at(-1));
    } catch { /* The report below records the missing receipt. */ }
    const summary = receipt ? renderDeploymentReceipt(receipt, baselineCommit) : '### 生产发布回执\n- 未取得回执：部署步骤失败或未运行，查看上一步日志。';
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } else {
    console.error(`Unknown action: ${action || '(none)'}`);
    process.exitCode = 2;
  }
}
