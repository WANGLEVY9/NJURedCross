import { linkedRowIds, previewHoursEntry } from './volunteer-workflow.js';

// Keep the formal table's existing workbook contract; this module never uploads a file.
export const HOURS_EXPORT_COLUMNS = Object.freeze(['姓名', '院系', '学号', '具体工作地点', '正式工作日期', '培训时长', '交通时长', '服务时长', '志愿者具体工作内容', '备注']);
const SPECIAL = ['省红会组宣部', '省血液献血车', '校医院体检', '校医院急救培训', '康宇孤独症', '工位值班'];
const clean = value => typeof value === 'string' ? value.trim() : '';
function nonnegative(value, label) {
  if (value == null || value === '') return 0;
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw Object.assign(new Error(`${label}必须为非负有限数字`), { statusCode: 400 });
  }
  return Number(value);
}

export function previewHoursExport(registrations, checkins, requestedIds, config) {
  if (!config?._id) throw Object.assign(new Error('导出配置不存在'), { statusCode: 400 });
  const preview = previewHoursEntry(registrations, checkins, requestedIds);
  const linked = new Set(linkedRowIds(config['活动报名总表']));
  // Activity titles are not unique. Only explicit row links can authorize a configuration.
  if (preview.items.some(item => !linked.has(item.registrationId))) {
    throw Object.assign(new Error('所选报名记录与导出配置没有明确关联'), { statusCode: 409 });
  }
  const training = nonnegative(config['实际培训时长/小时'], '培训时长');
  const travel = nonnegative(config['实际交通时长/小时'], '交通时长');
  if (!preview.ready) return { ...preview, columns: HOURS_EXPORT_COLUMNS, rows: [], configId: config._id };
  const source = new Map(registrations.map(row => [row._id, row]));
  if (new Set(preview.items.map(item => item.activity)).size !== 1) {
    throw Object.assign(new Error('同一导出草稿不能混入不同活动'), { statusCode: 409 });
  }
  const special = preview.items.every(item => SPECIAL.some(word => item.activity.includes(word)));
  const identities = new Map();
  for (const item of preview.items) {
    if (identities.has(item.studentId) && identities.get(item.studentId) !== item.name) {
      throw Object.assign(new Error('同一学号出现不同姓名，须先核验身份'), { statusCode: 409 });
    }
    identities.set(item.studentId, item.name);
  }
  const groups = new Map();
  for (const item of preview.items) {
    const key = special ? item.studentId : item.registrationId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const warnings = ['培训、交通、服务时长分别列出；本预览不会将三者自动相加到个人主页。'];
  const rows = [...groups.values()].map(items => {
    const first = items[0];
    const repeats = preview.items.filter(item => item.studentId === first.studentId).length;
    let remark = clean(config['备注']);
    if (repeats >= 2) {
      remark += `${remark ? '；' : ''}【重复报名>=2次，请人工核查】`;
      warnings.push('存在同学多次报名，须核对日期、岗位与是否重复计时。');
    }
    return {
      姓名: first.name, 院系: clean(source.get(first.registrationId)?.['院系']), 学号: first.studentId,
      具体工作地点: clean(config['具体工作地点']),
      正式工作日期: special ? items.map(item => `${item.date}${item.slot ? ` ${item.slot}` : ''}`).join('；') : clean(config['正式工作日期']),
      培训时长: nonnegative(training * items.length, '合并培训时长'), 交通时长: nonnegative(travel * items.length, '合并交通时长'),
      服务时长: nonnegative(items.reduce((sum, item) => sum + item.hours, 0), '合并服务时长'),
      志愿者具体工作内容: clean(config['志愿者具体工作内容']), 备注: remark,
    };
  });
  if (rows.some(row => !row['正式工作日期'] || !row['具体工作地点'] || !row['志愿者具体工作内容'])) warnings.push('日期、地点或工作内容未补齐，暂不可作为正式录入表提交。');
  return { ...preview, configId: config._id, format: 'existing-ten-column-workbook', grouping: special ? 'student' : 'registration', columns: HOURS_EXPORT_COLUMNS, rows, warnings: [...new Set(warnings)], requiresManualReview: true };
}
