import { prepareAgentAcceptanceCase } from './acceptance.js';
import { parseAgentModelOutput } from './model-contract.js';
import {
  assessAgentDraftCandidate,
} from '../../public/app/shared/agent-draft-candidate.js';
import {
  buildAgentDraftRevision,
} from '../../public/app/shared/agent-draft-revision.js';

export async function runAgentAcceptance({ cases, model }) {
  const results = [];

  for (const definition of cases) {
    try {
      const prepared = prepareAgentAcceptanceCase(definition);
      const generated = await model.generate({
        task: prepared.task,
        instruction: prepared.instruction,
      });

      const output = parseAgentModelOutput(
        prepared.task,
        JSON.stringify(generated.output),
      );

      if (!Object.hasOwn(output, 'draft')) {
        throw new Error('缺少候选草稿');
      }

      const assessment = definition.kind === 'revision'
        ? buildAgentDraftRevision(prepared.baseTask, {
          fields: definition.fields,
          candidate: output.draft,
        })
        : assessAgentDraftCandidate(definition.mode, output.draft);

      results.push({
        id: definition.id,
        mode: definition.mode,
        kind: definition.kind,
        structuralPass: true,
        draftComplete: assessment.complete,
        issues: assessment.issues,
        changes: assessment.changes ?? [],
        manualReviewRequired: true,
        review: [...definition.review],
      });
    } catch {
      // 不将模型、网络或配置异常中的敏感信息放进报告。
      results.push({
        id: definition.id,
        mode: definition.mode,
        kind: definition.kind,
        structuralPass: false,
        error: '案例生成或结构校验失败，请检查对应测试。',
        manualReviewRequired: true,
        review: [...definition.review],
      });
    }
  }

  return {
    total: results.length,
    passed: results.filter(item => item.structuralPass).length,
    failed: results.filter(item => !item.structuralPass).length,
    manualReviewRequired: true,
    results,
  };
}