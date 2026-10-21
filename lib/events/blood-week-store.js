/**
 * 献血车周次自动化的持久状态：管理员配置、周次发布时间与执行回执。
 *
 * 只保存平台自己的决策（时间配置、运行记录），不复制底表排班行，
 * 也不保存任何志愿者身份信息。
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';

/** 默认：每周三生成下一周次岗位，每周四 09:00 在活动广场开放报名。 */
export const BLOOD_WEEK_DEFAULTS = Object.freeze({
  autoGenerate: true,
  generateWeekday: 3,
  generateHour: 9,
  generateMinute: 0,
  autoPublish: true,
  publishWeekday: 4,
  publishHour: 9,
  publishMinute: 0,
});
export const BLOOD_WEEK_SETTING_KEYS = Object.keys(BLOOD_WEEK_DEFAULTS);
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const invalid = (message) => Object.assign(new Error(message), {statusCode: 400, code: 'blood_week_settings_invalid'});

export function normalizeBloodWeekSettings(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('自动排班设置无效');
  const next = {...BLOOD_WEEK_DEFAULTS};
  for (const [key, value] of Object.entries(patch)) {
    if (!BLOOD_WEEK_SETTING_KEYS.includes(key)) throw invalid('自动排班设置字段无效');
    if (key === 'generateWeekday' || key === 'publishWeekday') {
      const day = Number(value);
      if (!WEEKDAYS.includes(day)) throw invalid('自动排班的周几必须是周一到周日');
      next[key] = day;
      continue;
    }
    if (key === 'generateHour' || key === 'publishHour') {
      const hour = Number(value);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw invalid('自动排班的小时必须是 0–23');
      next[key] = hour;
      continue;
    }
    if (key === 'generateMinute' || key === 'publishMinute') {
      const minute = Number(value);
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw invalid('自动排班的分钟必须是 0–59');
      next[key] = minute;
      continue;
    }
    if (typeof value !== 'boolean') throw invalid('自动排班开关必须是布尔值');
    next[key] = value;
  }
  return next;
}

export function createBloodWeekStore(file = ':memory:') {
  if (file !== ':memory:') {
    if (!isAbsolute(file)) throw new Error('献血车排班自动化存储需要绝对路径');
    mkdirSync(dirname(file), {recursive: true});
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=5000');
  db.exec('CREATE TABLE IF NOT EXISTS blood_week_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS blood_week_schedule (week_key TEXT PRIMARY KEY, publish_at TEXT NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS blood_week_run (run_key TEXT PRIMARY KEY, week_key TEXT NOT NULL, rows INTEGER NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL)');
  const settings = () => {
    const rows = db.prepare('SELECT key, value FROM blood_week_settings').all();
    return {...BLOOD_WEEK_DEFAULTS, ...Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value)]))};
  };
  const scheduleOf = weekKey => {
    const row = db.prepare('SELECT publish_at, source, actor, at FROM blood_week_schedule WHERE week_key=?').get(weekKey);
    return row ? {publishAt: row.publish_at, source: row.source, actor: row.actor, at: row.at} : null;
  };
  return {
    settings,
    saveSettings(patch, actor = '') {
      const next = normalizeBloodWeekSettings({...settings(), ...patch});
      const at = new Date().toISOString();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const key of BLOOD_WEEK_SETTING_KEYS) db.prepare('INSERT INTO blood_week_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(next[key]));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return {...next, actor, at};
    },
    schedule: scheduleOf,
    schedules() {
      return db.prepare('SELECT week_key, publish_at, source, actor, at FROM blood_week_schedule ORDER BY week_key').all()
        .map(row => ({weekKey: row.week_key, publishAt: row.publish_at, source: row.source, actor: row.actor, at: row.at}));
    },
    setSchedule(weekKey, publishAt, actor = '', source = 'auto') {
      if (typeof weekKey !== 'string' || !weekKey) throw invalid('周次标识无效');
      if (typeof publishAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(publishAt)) throw invalid('发布时间须为北京时间');
      db.prepare('INSERT INTO blood_week_schedule(week_key,publish_at,source,actor,at) VALUES(?,?,?,?,?) ON CONFLICT(week_key) DO UPDATE SET publish_at=excluded.publish_at,source=excluded.source,actor=excluded.actor,at=excluded.at')
        .run(weekKey, publishAt, source === 'manual' ? 'manual' : 'auto', String(actor || ''), new Date().toISOString());
      return scheduleOf(weekKey);
    },
    clearSchedule(weekKey) {
      db.prepare('DELETE FROM blood_week_schedule WHERE week_key=?').run(weekKey);
      return null;
    },
    run(key) {
      const row = db.prepare('SELECT run_key, week_key, rows, status, actor, at FROM blood_week_run WHERE run_key=?').get(key);
      return row ? {runKey: row.run_key, weekKey: row.week_key, rows: row.rows, status: row.status, actor: row.actor, at: row.at} : null;
    },
    markRun(key, {weekKey = '', rows = 0, status = 'created', actor = ''} = {}) {
      if (typeof key !== 'string' || !key) throw invalid('运行记录标识无效');
      const at = new Date().toISOString();
      db.prepare('INSERT INTO blood_week_run(run_key,week_key,rows,status,actor,at) VALUES(?,?,?,?,?,?) ON CONFLICT(run_key) DO UPDATE SET week_key=excluded.week_key,rows=excluded.rows,status=excluded.status,actor=excluded.actor,at=excluded.at')
        .run(key, String(weekKey || ''), Number(rows) || 0, String(status || 'created'), String(actor || ''), at);
      return {runKey: key, weekKey, rows, status, actor, at};
    },
    runs(limit = 5) {
      const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;
      return db.prepare('SELECT run_key, week_key, rows, status, actor, at FROM blood_week_run ORDER BY rowid DESC LIMIT ?').all(size)
        .map(row => ({runKey: row.run_key, weekKey: row.week_key, rows: row.rows, status: row.status, actor: row.actor, at: row.at}));
    },
    close: () => db.close(),
  };
}
