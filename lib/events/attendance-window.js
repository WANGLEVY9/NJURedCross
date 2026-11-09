/**
 * 统一的签到窗口判定（服务端）。
 *
 * 献血车沿用「班次开始后到整周归档 / 时长表提交为止」；其它活动改为
 * 「班次开始 → 班次结束 + 宽限期」，宽限期默认 48 小时，可由
 * ATTENDANCE_GRACE_HOURS 或活动配置 attendanceGraceHours 覆盖。
 * 这样「服务完发现签到结束了」不再依赖献血车特例，ordinary / legacy
 * 活动同样可以在结束后补传凭证。
 */
import { workflowConfig } from './blood-roster.js';
import { sessionWindow } from './ordinary-groups.js';
import { bloodConfig, bloodAttendanceOpen, bloodWeekArchived, generatedBlood } from '../../public/app/shared/blood-lifecycle.js';
import {scheduledSession} from '../../public/app/shared/schedule-board-layout.js';

export const DEFAULT_ATTENDANCE_GRACE_HOURS = 48;

export function attendanceGraceMs(event) {
  const configured = Number(workflowConfig(event).attendanceGraceHours);
  const environment = Number(process.env.ATTENDANCE_GRACE_HOURS);
  const hours = Number.isFinite(configured) && configured >= 0 ? configured
    : Number.isFinite(environment) && environment >= 0 ? environment
      : DEFAULT_ATTENDANCE_GRACE_HOURS;
  return Math.min(hours, 24 * 30) * 3_600_000;
}

export function attendanceBounds(event) {
  const c = workflowConfig(event);
  const fallbackDay = `${event['报名日期'] || ''}T`;
  const start = Date.parse(c.blood?.start || sessionWindow(event)?.start || c.window?.start || `${fallbackDay}00:00:00+08:00`);
  const end = Date.parse(c.blood?.end || sessionWindow(event)?.end || c.window?.end || `${fallbackDay}23:59:59+08:00`);
  return { start, end };
}

export function attendanceWindowOpen(event, events = [], now = Date.now()) {
  if (!event) return false;
  if (generatedBlood(event)) return bloodAttendanceOpen(event, events, now);
  if (!['报名中', '进行中', '已结束'].includes(event['状态'])) return false;
  if (bloodWeekArchived(event) || workflowConfig(event).workspaceRemoval) return false;
  if (events.some(row => bloodConfig(row).runningReview?.status === 'submitted')) return false;
  const { start, end } = attendanceBounds(event);
  if(scheduledSession(event))return Number.isFinite(start)&&now>=start;
  // 旧活动 / 合成活动可能没有窗口字段：按状态开放，不因为缺字段把现场签到关掉。
  if (!Number.isFinite(start)) return !Number.isFinite(end) || now <= end + attendanceGraceMs(event);
  if (now < start) return false;
  if (!Number.isFinite(end)) return true;
  return now <= end + attendanceGraceMs(event);
}
