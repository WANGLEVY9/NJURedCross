/* ==========================================================================
   venue-schema.js — tables and frozen value sets for activity-room borrowing.
   Status/category columns are plain text so the service enforces transitions;
   SeaTable single-select option seeding is never relied on.
   ========================================================================== */

import { planTableShapes, ensureTableShapes } from '../schema/ensure.js';

export const VENUE_ROOM_TABLE = '场地表';
export const VENUE_APPLICATION_TABLE = '场地借用申请表';

export const VENUE_ROOM_COLUMNS = Object.freeze({
  '场地名称': 'text',
  '地点': 'text',
  '可借开始时间': 'text',
  '可借结束时间': 'text',
  '容量': 'number',
  '状态': 'text',
  '备注': 'text',
});

export const VENUE_APPLICATION_COLUMNS = Object.freeze({
  '申请人姓名': 'text',
  '申请人账号': 'text',
  '场地ID': 'text',
  '场地名称': 'text',
  '开始时间': 'text',
  '结束时间': 'text',
  '用途': 'text',
  '状态': 'text',
  '审批人': 'text',
  '审批时间': 'text',
  '不通过理由': 'text',
  '备注': 'text',
  '提交时间': 'text',
});

export const VENUE_APPLICATION_STATUS = Object.freeze({
  PENDING: '待审批',
  APPROVED: '审批通过',
  REJECTED: '审批不通过',
  CANCELLED: '已取消',
});

export const VENUE_ROOM_STATUS = Object.freeze({ ENABLED: '启用', DISABLED: '停用' });

/** 第三方「指间管理」尚未对接；占用日历只在本平台内闭环。 */
export const VENUE_INTEGRATION_STATUS = 'pending';

export function venueFailure(statusCode, message, code = 'venue_invalid') {
  return Object.assign(new Error(message), { statusCode, code });
}

export function planVenueSchema(metadata) {
  return planTableShapes(metadata, { [VENUE_ROOM_TABLE]: VENUE_ROOM_COLUMNS, [VENUE_APPLICATION_TABLE]: VENUE_APPLICATION_COLUMNS }, venueFailure);
}

export async function ensureVenueSchema(client, { expectedUuid, apply = false, confirmation = '' } = {}) {
  return ensureTableShapes(client, {
    expectedUuid, apply, confirmation,
    tables: { [VENUE_ROOM_TABLE]: VENUE_ROOM_COLUMNS, [VENUE_APPLICATION_TABLE]: VENUE_APPLICATION_COLUMNS },
    failure: venueFailure,
    confirmationPhrase: 'ADD-VENUE',
  });
}
