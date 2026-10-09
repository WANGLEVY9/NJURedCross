/** Trusted default-branch code; never executes the tested branch or reads its artifacts. */
module.exports = async function notify({ github, context, core, collaborators, issueNumber }) {
  const run = context.payload.workflow_run;
  const repo = context.repo;
  const issue = Number(issueNumber);
  const handles = [...new Set(String(collaborators || '').split(',').map(s => s.trim()).filter(Boolean))];
  if (!Number.isSafeInteger(issue) || issue <= 0 || !handles.length || handles.some(h => !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(h))) {
    throw new Error('CI notification issue and collaborator list must be configured');
  }
  const marker = `<!-- ci-run:${run.id}:${run.run_attempt} -->`;
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: issue, per_page: 100 });
  if (comments.some(c => c.user?.login === 'github-actions[bot]' && c.body.includes(marker))) {
    core.info('This run attempt was already distributed');
    return;
  }
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, { ...repo, run_id: run.id, filter: 'latest', per_page: 100 });
  // Escape metadata supplied by branch authors to prevent fake mentions or Markdown links.
  const escape = s => String(s || '').replace(/[^\p{L}\p{N} _.,()/:-]/gu, '');
  const body = [marker,
    `### CI/CD：${escape(run.conclusion)}`,
    `提交：\`${run.head_sha.slice(0, 12)}\` · 分支：${escape(run.head_branch)} · 第 ${run.run_attempt} 次运行`,
    `[查看完整检查及部署结果](${run.html_url})`, '',
    '| 阶段 | 结果 |', '| --- | --- |',
    ...jobs.map(j => `| ${escape(j.name)} | ${escape(j.conclusion || j.status)} |`), '',
    '失败时请查看对应阶段日志；浏览器报告和部署回执位于运行页面的 Artifacts。测试失败不会进入生产部署。', '',
    handles.map(h => `@${h}`).join(' '),
  ].join('\n');
  await github.rest.issues.createComment({ ...repo, issue_number: issue, body });
};
