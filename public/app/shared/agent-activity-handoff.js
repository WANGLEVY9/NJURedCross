import { agentActivitySeed } from './agent-activity-draft.js';

export function agentActivityHandoff(task) {
  const confirmed = task?.taskType === 'conversation'
    ? task.status === 'result_ready'
    : Array.isArray(task?.steps) && task.steps.some(step =>
      step.id === 'configuration' && step.status === 'confirmed',
    );

  if (
    task?.mode !== 'activity' ||
    !confirmed ||
    !task.activityDraft
  ) {
    throw new Error('该任务尚无已保存、可带入的活动配置');
  }

  return agentActivitySeed(task.activityDraft);
}