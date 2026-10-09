import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const notify = createRequire(import.meta.url)('../.github/scripts/notify.cjs');

function fixture(comments = []) {
  const calls = [];
  const listComments = () => {};
  const listJobsForWorkflowRun = () => {};
  return {
    calls,
    github: {
      paginate: async method => method === listComments ? comments : [{name:'Quality gate',conclusion:'success'}, {name:'Deploy main to production',conclusion:'failure'}],
      rest: { issues: { listComments, createComment: async value => calls.push(value) }, actions: { listJobsForWorkflowRun } },
    },
    context: { repo: { owner:'synthetic',repo:'fixture' }, payload: { workflow_run: { id:42,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'branch @someone [fake](url)',conclusion:'failure',html_url:'https://github.com/synthetic/fixture/actions/runs/42' } } },
    core: { info() {} }, collaborators:'developer-one,developer-two,developer-one',issueNumber:'1',
  };
}
test('CI result includes deployment failure, all recipients and escaped branch metadata', async () => {
  const f = fixture(); await notify(f);
  const body = f.calls[0].body;
  assert.match(body, /Deploy main to production \| failure/);
  assert.match(body, /@developer-one @developer-two/);
  assert.equal(body.includes('@someone'), false);
  assert.equal(body.includes('[fake]'), false);
});
test('repeated result delivery is idempotent but a new attempt is delivered', async () => {
  const f = fixture([{user:{login:'github-actions[bot]'},body:'<!-- ci-run:42:1 -->'}]);
  await notify(f); assert.equal(f.calls.length,0);
  f.context.payload.workflow_run.run_attempt=2; await notify(f); assert.equal(f.calls.length,1);
});
test('invalid recipient configuration fails before posting', async () => {
  const f = fixture(); f.collaborators='@all';
  await assert.rejects(notify(f), /must be configured/); assert.equal(f.calls.length,0);
});
