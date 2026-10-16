import {
  AGENT_ACCEPTANCE_CASES,
} from '../tests/fixtures/agent-acceptance-cases.mjs';
import {
  runAgentAcceptance,
} from '../lib/agent/acceptance-runner.js';
import {
  createMockAgentModel,
} from '../lib/agent/mock-model.js';

// 固定使用模拟模型，避免环境配置意外触发真实模型调用。
const report = await runAgentAcceptance({
  cases: AGENT_ACCEPTANCE_CASES,
  model: createMockAgentModel(),
});

console.log('工作助手离线验收：模拟模型');
console.log('通过仅代表结构校验通过，事实与内容质量仍需人工审核。');
console.log(JSON.stringify(report, null, 2));

if (report.failed > 0) {
  process.exitCode = 1;
}