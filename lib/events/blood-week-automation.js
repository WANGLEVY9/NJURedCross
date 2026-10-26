/**
 * 献血车周次排班的生成规划与写入。
 *
 * 每周岗位固定：以底表中最新的一周为模板，只把日期换成目标周次，
 * 名额、点位与班次完全沿用模板周；旧周的报名人、学号、邮箱一律不复制。
 */
import { BLOOD_POINTS, BLOOD_SHIFTS } from './blood-roster.js';
import { bloodWeekStart, bloodWeekEnd, bloodWeekLabel, bloodWeekName, bloodWeekKey } from '../../public/app/shared/activity-projects.js';

const DAY_MS = 86_400_000;
const fail = (statusCode, message, code = 'blood_week_conflict') => Object.assign(new Error(message), {statusCode, code});
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const STOPPED = ['停点', '已停点'];

export { bloodWeekStart, bloodWeekEnd, bloodWeekLabel, bloodWeekName, bloodWeekKey };

/** 上海时间的日期与星期；排班只看北京时间，不受服务器时区影响。 */
export function shanghaiDate(timestamp = Date.now()) {
  return new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10);
}
export function shanghaiParts(timestamp = Date.now()) {
  const date = shanghaiDate(timestamp);
  const day = new Date(`${date}T00:00:00Z`);
  const clock = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23'}).format(new Date(timestamp));
  const [hour, minute] = clock.split(':').map(Number);
  return {date, weekday: (day.getUTCDay() + 6) % 7 + 1, hour, minute};
}
export function shiftDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
export function bloodWeekDays(monday) {
  return Array.from({length: 7}, (_, index) => shiftDays(monday, index));
}
/** 以“现在”为基准，取下一个周几的北京时间整点；已过则顺延一周。 */
export function nextWeekdayInstant({from = Date.now(), weekday = 4, hour = 9, minute = 0} = {}) {
  const monday = bloodWeekStart(shanghaiDate(from));
  let timestamp = Date.parse(`${monday}T00:00:00+08:00`) + ((Number(weekday) - 1) % 7) * DAY_MS + Number(hour) * 3_600_000 + Number(minute) * 60_000;
  if (timestamp <= from) timestamp += 7 * DAY_MS;
  return `${new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;
}
export const bloodSourceRowDate = row => String(row?.['日期'] || '').slice(0, 10);
const usableRow = row => isDate(bloodSourceRowDate(row)) && BLOOD_POINTS.includes(row['点位']) && BLOOD_SHIFTS.includes(row['活动时间']) && Number.isInteger(Number(row['周次'])) && Number(row['周次']) >= 1;

/** 按周一归组底表行；组内周次不一致时标记 inconsistent，不用作模板。 */
export function bloodWeekInventory(rows = []) {
  const weeks = new Map();
  for (const row of rows) {
    if (!usableRow(row)) continue;
    const monday = bloodWeekStart(bloodSourceRowDate(row));
    if (!monday) continue;
    let week = weeks.get(monday);
    if (!week) {
      week = {monday, sunday: bloodWeekEnd(monday), label: bloodWeekLabel(monday), week: Number(row['周次']), weeks: new Set(), rows: []};
      weeks.set(monday, week);
    }
    week.weeks.add(Number(row['周次']));
    week.rows.push(row);
  }
  return [...weeks.values()].sort((a, b) => a.monday.localeCompare(b.monday)).map(week => ({
    monday: week.monday,
    sunday: week.sunday,
    label: week.label,
    week: week.weeks.size === 1 ? week.week : null,
    inconsistent: week.weeks.size !== 1,
    rows: week.rows,
  }));
}

/**
 * 规划下一个周次的岗位。底表通常已有本周与下周，因此默认生成的是
 * 当前周之后的第二周（下下周），也就是志愿者实际要报名的那一周；
 * 该周次已有底表记录时不重复生成。
 */
export function planBloodWeek({rows = [], now = Date.now(), monday = null, templateMonday = null, weeksAhead = 2} = {}) {
  const weeks = bloodWeekInventory(rows);
  if (!weeks.length) throw fail(409, '底表还没有可用于复制的献血车排班周次');
  let target = String(monday || '').trim();
  if (target) {
    if (!isDate(target) || bloodWeekStart(target) !== target) throw fail(400, '目标周次必须是有效的周一日期');
  } else {
    const ahead = Number.isInteger(weeksAhead) && weeksAhead >= 1 && weeksAhead <= 8 ? weeksAhead : 2;
    target = shiftDays(bloodWeekStart(shanghaiDate(now)), 7 * ahead);
  }
  // 模板取目标周次之前最近的一周：每周岗位固定，只把日期换成目标周。
  const before = weeks.filter(week => week.monday < target);
  const template = templateMonday ? weeks.find(week => week.monday === templateMonday) : (before.length ? before.at(-1) : weeks[0]);
  if (!template) throw fail(404, '所选模板周次不在底表中，请刷新后重试');
  if (template.inconsistent) throw fail(409, `模板周次 ${template.label} 的周次号不一致，请先在底表核对`);
  const existing = rows.filter(row => isDate(bloodSourceRowDate(row)) && bloodWeekStart(bloodSourceRowDate(row)) === target).length;
  const offsetWeeks = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${template.monday}T00:00:00Z`)) / DAY_MS / 7);
  const week = Number(template.week) + offsetWeeks;
  if (!Number.isInteger(week) || week < 1 || week > 999) throw fail(409, '生成的周次号无效，请先在底表核对周次');
  const positions = [...template.rows]
    .sort((a, b) => `${bloodSourceRowDate(a)}|${a['点位']}|${a['活动时间']}`.localeCompare(`${bloodSourceRowDate(b)}|${b['点位']}|${b['活动时间']}`) || String(a._id).localeCompare(String(b._id)))
    .map(row => {
      const offset = Math.round((Date.parse(`${bloodSourceRowDate(row)}T00:00:00Z`) - Date.parse(`${template.monday}T00:00:00Z`)) / DAY_MS);
      return {日期: shiftDays(target, offset), 点位: row['点位'], 活动时间: row['活动时间'], 周次: week, 报名结果: STOPPED.includes(row['报名结果']) ? '停点' : '可报名'};
    });
  return {
    monday: target,
    sunday: bloodWeekEnd(target),
    label: bloodWeekLabel(target),
    name: bloodWeekName(target),
    key: bloodWeekKey(target),
    week,
    template: {monday: template.monday, label: template.label, week: Number(template.week), rows: template.rows.length},
    positions,
    existing,
    weeks: weeks.map(week_ => ({monday: week_.monday, sunday: week_.sunday, label: week_.label, week: week_.week, rows: week_.rows.length, inconsistent: week_.inconsistent})),
  };
}

/** 批量写入底表；SDK 支持批量接口时按批提交，否则逐行写入。 */
export async function appendBloodWeekRows(base, table, positions, {batchSize = 200} = {}) {
  if (!positions.length) return {appended: 0, batches: 0};
  let batches = 0;
  if (typeof base.batchAppendRows === 'function') {
    for (let index = 0; index < positions.length; index += batchSize) {
      const chunk = positions.slice(index, index + batchSize);
      const result = await base.batchAppendRows(table, chunk);
      if (result && Number.isFinite(Number(result.inserted_row_count)) && Number(result.inserted_row_count) !== chunk.length) throw fail(502, '底表批量写入行数不一致，请刷新核对后再试');
      batches += 1;
    }
    return {appended: positions.length, batches};
  }
  for (const row of positions) {
    await base.appendRow(table, row);
    batches += 1;
  }
  return {appended: positions.length, batches};
}
