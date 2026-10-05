import { createHash } from 'node:crypto';
import { HOURS_EXPORT_COLUMNS } from './hours-export.js';

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const hourKeys = ['服务时长', '培训时长', '交通时长'];
const specialActivities = ['省红会组宣部', '省血液献血车', '献血车志愿服务', '校医院体检', '校医院急救培训', '康宇孤独症', '工位值班'];

export function reviewDetails(event, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['serviceHours', 'trainingHours', 'travelHours', 'work', 'expectedDigest'].includes(key))) {
    throw fail('时长录入字段无效', 400);
  }
  const values = [input.serviceHours ?? event['服务时长'], input.trainingHours ?? event['培训时长'], input.travelHours ?? event['交通时长']];
  const details = {};
  values.forEach((value, index) => {
    const n = Number(value);
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(n)
      || n < 0 || n > 100000 || (index === 0 && n === 0)) throw fail(`${hourKeys[index]}须为有效${index === 0 ? '正' : '非负'}数`, 400);
    details[hourKeys[index]] = String(n);
  });
  const work = input.work ?? event['工作内容'];
  if (typeof work !== 'string' || !work.trim() || work.trim().length > 500) throw fail('工作内容须为 1～500 字', 400);
  details['工作内容'] = work.trim();
  return details;
}

export function reviewDigest(row) {
  return createHash('sha256').update(JSON.stringify(['幂等键', '活动ID', '报名行ID', '签到行ID', '账号ID', '学号', '姓名', '规则版本',
    ...hourKeys, '工作内容', '核对人', '来源摘要'].map(key => String(row[key] ?? '')))).digest('hex');
}

export function assertReviewedLedger(row, source) {
  const registration = source.registration;
  if (row['活动ID'] !== source.event['活动ID'] || row['签到行ID'] !== source.checkin._id
    || row['幂等键'] !== `SERVICE:${registration._id}` || String(row['规则版本']) !== String(source.event['申请版本'])
    || ['账号ID', '学号', '姓名'].some(key => row[key] !== registration[key])) throw fail('时长明细与活动或参与者关联不一致，请先核验');
  const versioned = String(row['来源摘要'] || '').startsWith('v2:');
  if (row['来源摘要'] !== (versioned ? `v2:${source.sourceHash}` : source.sourceHash)) throw fail('源记录已改变，请重新核验');
  if (versioned) {
    if (!row['核对摘要'] || row['核对摘要'] !== reviewDigest(row)) throw fail('核定时长或工作内容已改变，请重新核验');
    reviewDetails(source.event, { serviceHours: row['服务时长'], trainingHours: row['培训时长'], travelHours: row['交通时长'], work: row['工作内容'] });
  } else if (hourKeys.some(key => Number(row[key]) !== Number(source.event[key]))) {
    throw fail('候选时长已改变，请重新核验');
  }
}

export function reviewWorkbookRows(event, entries, registrations) {
  const sources = new Map(registrations.map(row => [row._id, row]));
  const grouped = specialActivities.some(name => event['活动名称'].includes(name));
  const groups = new Map();
  for (const entry of entries) {
    const registration = sources.get(entry['报名行ID']);
    if (!registration) throw fail('报名来源不存在');
    const key = grouped ? entry['学号'] : entry['报名行ID'];
    const current = groups.get(key);
    if (current && current.姓名 !== entry['姓名']) throw fail('同一学号出现不同姓名，请先核验');
    const date = [registration['报名日期'], registration['报名时段']].filter(Boolean).join(' ');
    const work = entry['工作内容'] || event['工作内容'];
    if (!current) groups.set(key, { 姓名: entry['姓名'], 院系: registration['院系'] || '', 学号: entry['学号'],
      具体工作地点: event['地点'], 正式工作日期: date, 培训时长: Number(entry['培训时长']), 交通时长: Number(entry['交通时长']),
      服务时长: Number(entry['服务时长']), 志愿者具体工作内容: work, 备注: '', _ledgerIds: [entry._id] });
    else {
      for (const name of hourKeys) { current[name] += Number(entry[name]); if (!Number.isFinite(current[name])) throw fail('合并时长超出有效范围'); }
      current.正式工作日期 = [...new Set([...current.正式工作日期.split('；'), date])].join('；');
      current.志愿者具体工作内容 = [...new Set([...current.志愿者具体工作内容.split('；'), work])].join('；');
      current.备注 = '同一同学多条服务记录合并，请核对日期与时长';
      current._ledgerIds.push(entry._id);
    }
  }
  return { columns: HOURS_EXPORT_COLUMNS, rows: [...groups.values()].map(row => Object.fromEntries(HOURS_EXPORT_COLUMNS.map(key => [key, row[key]]))),
    grouping: grouped ? 'student' : 'registration' };
}
