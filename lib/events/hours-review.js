import { createHash } from 'node:crypto';
import { HOURS_EXPORT_COLUMNS } from './hours-export.js';

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const hourKeys = ['服务时长', '培训时长', '交通时长'];
const specialActivities = ['省红会组宣部', '省血液献血车', '献血车志愿服务', '校医院体检', '校医院急救培训', '康宇孤独症', '工位值班'];

export function reviewDetails(event, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['serviceHours', 'trainingHours', 'travelHours', 'work', 'location', 'dates', 'remark', 'expectedDigest'].includes(key))) {
    throw fail('时长录入字段无效', 400);
  }
  const values = [input.serviceHours ?? event['服务时长'], input.trainingHours ?? event['培训时长'], input.travelHours ?? event['交通时长']];
  const details = {};
  values.forEach((value, index) => {
    const n = Number(value);
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(n)
      || n < 0 || n > 100000) throw fail(`${hourKeys[index]}须为有效非负数`, 400);
    details[hourKeys[index]] = String(n);
  });
  const work = input.work ?? event['工作内容'];
  if (typeof work !== 'string' || !work.trim() || work.trim().length > 500) throw fail('工作内容须为 1～500 字', 400);
  details['工作内容'] = work.trim();
  for (const [key, column, fallback, max] of [['location', '具体工作地点', event['地点'] || '', 1000], ['dates', '正式工作日期', [event['报名日期'], event['报名时段']].filter(Boolean).join(' '), 4000], ['remark', '备注', '', 1000]]) {
    const value = input[key] ?? fallback;
    if (typeof value !== 'string' || value.length > max || (key !== 'remark' && !value.trim())) throw fail(`${column}须填写且不超过${max}字`, 400);
    details[column] = value.trim().replace(/\r\n?/g, '\n');
  }
  return details;
}

export function reviewDigest(row) {
  const keys = ['幂等键', '活动ID', '报名行ID', '签到行ID', '账号ID', '学号', '姓名', '规则版本', ...hourKeys, '工作内容', '核对人', '来源摘要'];
  if (String(row['来源摘要']).startsWith('v3:')) keys.push('具体工作地点', '正式工作日期', '备注', '修订人', '修订时间');
  return createHash('sha256').update(JSON.stringify(keys.map(key => String(row[key] ?? '')))).digest('hex');
}

export function assertReviewedLedger(row, source) {
  const registration = source.registration;
  if (row['活动ID'] !== source.event['活动ID'] || row['签到行ID'] !== source.checkin._id
    || row['幂等键'] !== `SERVICE:${registration._id}` || String(row['规则版本']) !== String(source.event['申请版本'])
    || ['账号ID', '学号', '姓名'].some(key => row[key] !== registration[key])) throw fail('时长明细与活动或参与者关联不一致，请先核验');
  const version = /^v[23]:/.exec(String(row['来源摘要'] || ''))?.[0];
  const versioned = Boolean(version);
  // Upstream stored adjusted hours as a hash of the source and three amounts.
  // Keep verifying that signature for existing rows; new rows use the versioned review digest.
  const adjustedHash = createHash('sha256').update(JSON.stringify([source.sourceHash, ...hourKeys.map(key => Number(row[key]))])).digest('hex');
  if (!versioned && row['来源摘要'] === adjustedHash) {
    reviewDetails(source.event, { serviceHours: row['服务时长'], trainingHours: row['培训时长'], travelHours: row['交通时长'] });
    return;
  }
  if (row['来源摘要'] !== (versioned ? `${version}${source.sourceHash}` : source.sourceHash)) throw fail('源记录已改变，请重新核验');
  if (versioned) {
    if (!row['核对摘要'] || row['核对摘要'] !== reviewDigest(row)) throw fail('核定时长或工作内容已改变，请重新核验');
    reviewDetails(source.event, { serviceHours: row['服务时长'], trainingHours: row['培训时长'], travelHours: row['交通时长'], work: row['工作内容'], ...(version === 'v3:' ? { location: row['具体工作地点'], dates: row['正式工作日期'], remark: row['备注'] } : {}) });
  } else if (hourKeys.some(key => Number(row[key]) !== Number(source.event[key]))) {
    throw fail('候选时长已改变，请重新核验');
  }
}

export function reviewWorkbookRows(event, entries, registrations, { events = [event], monthly = false, includeZero = false } = {}) {
  const sources = new Map(registrations.map(row => [row._id, row]));
  const grouped = monthly || specialActivities.some(name => event['活动名称'].includes(name));
  const eventMap = new Map(events.map(row => [row['活动ID'], row]));
  const groups = new Map();
  const names = new Map();
  // Keep the downloaded workbook in the same registration-time order as the review page.
  const registrationOrder = new Map([...registrations].sort((a, b) => String(a['创建时间'] || '').localeCompare(String(b['创建时间'] || ''))).map((row, index) => [row._id, index]));
  const ordered = [...entries].sort((a, b) => (registrationOrder.get(a['报名行ID']) ?? Infinity) - (registrationOrder.get(b['报名行ID']) ?? Infinity));
  for (const entry of ordered) {
    const registration = sources.get(entry['报名行ID']);
    if (!registration) throw fail('报名来源不存在');
    if (names.has(entry['学号']) && names.get(entry['学号']) !== entry['姓名']) throw fail('同一学号出现不同姓名，请先核验');
    names.set(entry['学号'], entry['姓名']);
    const sourceEvent = eventMap.get(entry['活动ID']) || event;
    const key = grouped ? JSON.stringify([entry['学号'], entry['姓名']]) : entry['报名行ID'];
    const current = groups.get(key);
    if (current && current.姓名 !== entry['姓名']) throw fail('同一学号出现不同姓名，请先核验');
    if (Number(entry['服务时长']) <= 0 && !includeZero) continue;
    const date = (entry['正式工作日期'] ?? [registration['报名日期'], registration['报名时段']].filter(Boolean).join(' ')).replace(/；/g, '\n');
    const work = entry['工作内容'] || sourceEvent['工作内容'];
    const location = entry['具体工作地点'] ?? sourceEvent['地点'];
    const positive = Number(entry['服务时长']) > 0;
    if (!current) groups.set(key, { 姓名: entry['姓名'], 院系: registration['院系'] || '', 学号: entry['学号'],
      具体工作地点: positive ? location : '', 正式工作日期: positive ? date : '', 培训时长: positive ? Number(entry['培训时长']) : 0, 交通时长: positive ? Number(entry['交通时长']) : 0,
      服务时长: Number(entry['服务时长']), 志愿者具体工作内容: positive ? work : '', 备注: entry['备注'] || '', _ledgerIds: [entry._id] });
    else {
      if (positive) {
        for (const name of hourKeys) { current[name] = Math.round((current[name] + Number(entry[name])) * 1e8) / 1e8; if (!Number.isFinite(current[name])) throw fail('合并时长超出有效范围'); }
        for (const [column, value] of [['正式工作日期', date], ['具体工作地点', location], ['志愿者具体工作内容', work]]) current[column] = [...new Set([...current[column].split(/\n|；/), ...String(value).split(/\n|；/)].filter(Boolean))].join('\n');
      }
      current.备注 = [...new Set([current.备注, entry['备注']].filter(Boolean))].join('\n');
      current._ledgerIds.push(entry._id);
    }
  }
  return { columns: HOURS_EXPORT_COLUMNS, rows: [...groups.values()].map(row => Object.fromEntries(HOURS_EXPORT_COLUMNS.map(key => [key, row[key]]))),
    groups: [...groups.values()].map(row => ({ ids: row._ledgerIds })), grouping: grouped ? 'student' : 'registration' };
}
