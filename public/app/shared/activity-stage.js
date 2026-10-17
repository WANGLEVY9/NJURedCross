/**
 * 活动六环节的唯一判定来源。
 *
 * 数据库里的 `状态` 只有 草稿 / 待审核 / 可发布 / 报名中 / 进行中 / 停点 / 已结束 / 已归档，
 * 而负责人看到的是「待审核 → 待发布 → 报名中 → 进行中 → 时长审核 → 已结束」。
 * 「时长审核」由独立的整表提交记录决定，不改写已经批准的报名配置。
 * 未携带提交记录的旧 DTO 仍按时长记录判断，兼容历史调用方。
 *
 * 本模块是纯函数，不读 DOM、不发请求，便于单元测试与两处复用。
 */
export const WORKFLOW_STEPS = Object.freeze([
  { id: 'approval', label: '待审核' },
  { id: 'ready', label: '待发布' },
  { id: 'registering', label: '报名中' },
  { id: 'running', label: '进行中' },
  { id: 'hours', label: '时长审核' },
  { id: 'ended', label: '已结束' },
]);

const LEDGER_STATES = ['待批准', '已批准', '已入账', '已退回'];

const STAGE_META = Object.freeze({
  draft: { label: '草稿', tone: 'warning', step: 0 },
  approval: { label: '待审核', tone: 'warning', step: 1 },
  ready: { label: '待发布', tone: 'accent', step: 2 },
  registering: { label: '报名中', tone: 'success', step: 3 },
  running: { label: '进行中', tone: 'success', step: 4 },
  hours: { label: '时长审核', tone: 'accent', step: 5 },
  ended: { label: '已结束', tone: 'neutral', step: 6 },
  archived: { label: '已归档', tone: 'neutral', step: 0 },
});

const config = event => {
  try { return JSON.parse(event?.['报名页配置'] || '{}'); } catch { return {}; }
};

/** 时长表是否已经提交（有任何一条时长记录即视为已提交）。 */
export function hasSubmittedHours(ledger = []) {
  return ledger.some(row => LEDGER_STATES.includes(row?.['状态']));
}

export function activityStage(event, { ledger = [] } = {}) {
  const status = event?.['状态'] || '草稿';
  if (status === '已归档') return 'archived';
  if (status === '草稿') return 'draft';
  if (status === '待审核') return 'approval';
  if (status === '可发布') return 'ready';
  if (status === '报名中') return 'registering';
  if (status === '进行中' || status === '停点') return event.hoursSubmission ? event.hoursSubmission.phase==='submitted'?'hours':'running' : hasSubmittedHours(ledger) ? 'hours' : 'running';
  if (status === '已结束') return 'ended';
  return 'draft';
}

export function stageLabel(stage) {
  return STAGE_META[stage]?.label || '草稿';
}

export function stageTone(stage) {
  return STAGE_META[stage]?.tone || 'neutral';
}

export function stageProgress(stage) {
  const step = STAGE_META[stage]?.step || 0;
  return WORKFLOW_STEPS.map((item, index) => ({ ...item, current: index + 1 === step, done: step > 0 && index + 1 < step }));
}

/** 下一步提示，用于状态栏右侧说明；没有下一环节时给出收尾说明。 */
export function nextStepHint(stage) {
  const hint = {
    draft: '补全活动信息后提交审批。',
    approval: '等待分管主席审批；退回后可修改并重新提交。',
    ready: '审批已通过，发布后即开放报名。',
    registering: '报名结束后点击「报名截止」，进入现场签到与时长录入。',
    running: '录入签到与时长后提交时长表，进入时长审核。',
    hours: '分管主席核对时长并导出 Excel，完成后结束活动。',
    ended: '活动已结束，仅保留查看与导出。',
    archived: '活动在回收站，可恢复后继续。',
  };
  return hint[stage] || '';
}

/**
 * 环节操作按钮。`intent` 由调用方映射到具体请求，本模块只决定「该不该出现、能不能点」。
 * @param {{canReview:boolean,isOwner:boolean,superAdmin:boolean,project?:boolean,ledger?:Array}} viewer
 */
export function stageActions(stage, viewer = {}) {
  const { canReview = false, isOwner = false, superAdmin = false, project = false, ledger = [] } = viewer;
  const manager = Boolean(superAdmin || canReview || isOwner);
  const reviewerOnly = Boolean(superAdmin || canReview);
  const action = (id, label, extra = {}) => ({ id, label, intent: id, variant: 'secondary', ...extra });

  switch (stage) {
    case 'draft':
      return manager ? [action('submit', '提交审批', { variant: 'primary' })] : [];
    case 'approval':
      return reviewerOnly
        ? [action('approve', '审批通过', { variant: 'primary' }), action('return-approval', '审批不通过')]
        : [];
    case 'ready':
      return manager
        ? [
            action('publish-now', '立即发布', { variant: 'primary' }),
            action('publish-schedule', '定时发布'),
            action('copy-notice', '复制报名通知'),
          ]
        : [];
    case 'registering':
      return manager
        ? [action(project ? 'close-project' : 'close-event', '报名截止', { variant: 'primary' })]
        : [];
    case 'running':
      return manager ? [action('submit-hours', '提交时长表', { variant: 'primary' })] : [];
    case 'hours':
      // 时长审核只对分管主席开放操作；负责人可查看但不可批准。
      return reviewerOnly
        ? [action('preview-hours', '在线预览'), action('export-hours', '导出 Excel', { variant: 'primary' }),action('finish','结束活动')]
        : [action('preview-hours', '在线预览')];
    case 'ended':
      return [action('view-hours', '查看时长表', { variant: 'primary' })];
    case 'archived':
      return manager ? [action('restore', '恢复活动')] : [];
    default:
      return [];
  }
}

/** 活动信息修改是否可用：已发布或已有参与记录都不能改写批准范围。 */
export function canEditMeta(event, { ledger = [] } = {}) {
  const stage = activityStage(event, { ledger });
  if (!['draft', 'approval', 'ready'].includes(stage)) return false;
  const parsed = config(event);
  if (parsed.positionPlan || parsed.parentActivityId) return false;
  if (parsed.source?.kind === 'generated_blood') return false;
  return true;
}

/** 状态栏右侧的流程提示文案。 */
export function stageSummary(event, { ledger = [] } = {}) {
  const stage = activityStage(event, { ledger });
  const submitted = hasSubmittedHours(ledger);
  const pendingHours = ledger.filter(row => row?.['状态'] === '待批准').length;
  const base = `${stageLabel(stage)}${submitted && stage !== 'hours' ? ' · 已录入时长' : ''}`;
  const extra = stage === 'hours' && pendingHours ? ` · ${pendingHours} 条待批准` : '';
  return base + extra;
}
