import {
  buildConversationMessages,
  parseConversationOutput,
} from './conversation-contract.js';
import {
  normalizeAgentDraftCandidate,
} from '../../public/app/shared/agent-draft-candidate.js';

const TEMPLATES = {
  activity: {
    title: '模拟活动筹备方案',
    items: [
      '活动安排：围绕用户需求准备课程、签到、课堂与总结环节。',
      '建议分工：按实际人员情况安排授课、签到引导和现场协助。',
      '物资建议：按课程内容核对教具、耗材和场地设备，不假定系统库存。',
      '关键缺口：集中核对未填写的时间、地点及必要准备条件。',
    ],
  },
  writing: {
    title: '模拟推文方案',
    items: [
      '标题与开篇：围绕宣传目标组织表达。',
      '正文：使用已经提供的事实，未提供的活动结果不编造。',
      '结尾：根据宣传目的安排行动提示。',
      '核对事项：集中检查事实、引用和素材授权。',
    ],
  },
  design: {
    title: '模拟美编方案',
    items: [
      '版式：按标题、导语、正文与结尾组织阅读层次。',
      '配色：使用平台支持的配色选项。',
      '素材：根据已有素材安排位置，不声称查看了未提供的图片。',
      '核对事项：检查手机阅读、对比度和素材授权。',
    ],
  },
};

export function generateMockConversation({ task, instruction = '' }) {
  // 与真实模型共用请求校验，避免两种模式接受不同状态。
  buildConversationMessages({ task, instruction });

  const understanding = [
    'awaiting_understanding',
    'awaiting_confirmation',
  ].includes(task.status);

  let output;

  if (understanding) {
    output = {
      summary: [
        `模拟需求理解：${task.brief.slice(0, 350)}`,
        '模拟模式不自动提取事实，请在需求卡中补充或修正字段。',
        '未知信息可以留空；确认后一次生成方案。',
      ].join('\n'),
      draft: normalizeAgentDraftCandidate(
        task.mode,
        task.understanding?.draft ?? {},
      ),
    };
  } else {
    const template = TEMPLATES[task.mode];

    output = {
      title: template.title,
      summary: instruction.trim()
        ? `模拟修改演示，已记录意见：${instruction.trim().slice(0, 800)}。字段保持原值；真实语义修改由真实模型完成。`
        : '模拟完整方案，仅演示对话流程；实际内容仍需核对和完善。',
      items: [...template.items],
      draft: normalizeAgentDraftCandidate(
        task.mode,
        task.output?.draft ?? task.confirmedDraft ?? {},
      ),
    };
  }

  return {
    provider: 'mock',
    simulated: true,
    output: parseConversationOutput(task, JSON.stringify(output)),
  };
}