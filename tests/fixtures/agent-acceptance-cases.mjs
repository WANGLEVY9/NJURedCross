const activityDraft = {
  name: '合成急救知识课堂',
  category: '急救培训',
  center: '生命中心',
  region: '南京活动',
  date: '2026-11-01',
  startTime: '09:00',
  endTime: '11:00',
  location: '合成教室 A',
  position: '合成引导岗位',
  capacity: 20,
  registrationLimit: 30,
  trainingHours: 0,
  travelHours: 0,
  content: '合成急救知识讲解与练习',
  work: '合成签到引导和课堂协助',
};

const writingDraft = {
  title: '合成急救课堂活动回顾',
  lead: '以下资料仅用于合成验收。',
  body: '合成活动于 2026 年 9 月 12 日在合成教室 A 举行，共 20 人参加。',
  closing: '后续活动安排尚未提供。',
  sourceNotes: '人数、日期和地点来自合成验收资料，照片授权未确认。',
};

const designDraft = {
  title: '合成活动回顾美编方案',
  audience: '大学新生',
  headline: '合成急救课堂回顾',
  introduction: '以下内容仅用于合成版式验收。',
  body: '合成活动共有 20 人参加，正文应保持易读，避免过密排版。',
  footer: '后续安排待确认。',
  imageNotes: '仅预留配图位置，照片与授权尚未提供。',
  reviewNotes: '检查手机阅读、文字对比度和素材授权。',
  palette: 'rose',
  layout: 'editorial',
};

const definitions = {
  activity: {
    completeBrief:
      '合成验收：筹备“合成急救知识课堂”。日期 2026-11-01，09:00—11:00，地点合成教室 A，南京地区，生命中心，急救培训。推荐录取 20 人，上限 30 人，培训和交通时长均为 0。活动内容为急救知识讲解与练习，岗位工作为签到引导和课堂协助。负责人账号尚未提供。',
    missingBrief:
      '合成验收：想举办一次面向新生的公益活动，日期、地点、人数和具体内容都尚未确定。',
    currentDraft: activityDraft,
    fields: ['name'],
    instruction: '只把活动名称改得更简洁，日期、时段、人数及其他内容保持原样。',
    review: [
      '不得编造负责人账号、物资库存或审批结果。',
      '日期、时段、地点和人数只能取自需求。',
      '服务时长应与 09:00—11:00 相符。',
    ],
  },
  writing: {
    completeBrief:
      '合成验收：写一篇活动回顾。合成急救课堂于 2026 年 9 月 12 日在合成教室 A 举行，共 20 人参加，内容为急救知识讲解与练习。读者为大学新生。没有真实引语，没有满意度调查，没有照片授权信息，后续活动安排尚未确定。',
    missingBrief:
      '合成验收：帮我写一篇公益活动回顾，但活动名称、举办日期、地点、人数和成果资料尚未提供。',
    currentDraft: writingDraft,
    fields: ['title'],
    instruction: '只让标题更简洁、更适合活动回顾，正文中的事实及其他字段保持原样。',
    review: [
      '不得虚构参与者引语、满意度或活动成果。',
      '不得把 20 人改成其他人数。',
      '不得声称照片已获授权或后续活动已经确定。',
    ],
  },
  design: {
    completeBrief:
      '合成验收：为活动回顾提出手机阅读的美编方案。读者是大学新生，主题是合成急救课堂，已知共有 20 人参加。使用柔和配色和清晰文字层级，只提供图文版式示意。尚未提供照片和标志，也未确认素材授权。',
    missingBrief:
      '合成验收：想美化一篇推文，但主题、读者、正文和图片素材都尚未确定。',
    currentDraft: designDraft,
    fields: ['headline'],
    instruction: '只修改预览主标题，让它更清晰，正文、配色、布局和其他字段保持原样。',
    review: [
      '只能使用支持的配色和版式选项。',
      '不得声称已经分析、生成或获得图片授权。',
      '正文保持可读，内部核对事项不进入对外预览。',
    ],
  },
};

export const AGENT_ACCEPTANCE_CASES = Object.freeze(
  Object.entries(definitions).flatMap(([mode, definition]) => [
    {
      id: `${mode}-complete`,
      synthetic: true,
      mode,
      kind: 'complete',
      brief: definition.completeBrief,
      review: [
        ...definition.review,
        '字段格式完整不代表事实已通过审核。',
      ],
    },
    {
      id: `${mode}-missing`,
      synthetic: true,
      mode,
      kind: 'missing',
      brief: definition.missingBrief,
      review: [
        ...definition.review,
        '缺失事实应留空或列为待确认，不能自行补造。',
        '应明确提出需要补充的问题。',
      ],
    },
    {
      id: `${mode}-revision`,
      synthetic: true,
      mode,
      kind: 'revision',
      brief: definition.completeBrief,
      currentDraft: structuredClone(definition.currentDraft),
      fields: [...definition.fields],
      instruction: definition.instruction,
      review: [
        ...definition.review,
        '只改变所选字段，其余字段保持原样。',
        '修改建议不得自动保存或发布。',
      ],
    },
  ]),
);