/**
 * 献血车点位负责人。服务端专用：账号 ID 不导出到前端产物，
 * 避免把权限主体的标识散进公开静态资源。
 *
 * 影响面有两处，都在服务端裁决：
 *   · 该点位班次的报名筛选与请假审批权（`assertRegistrarEvidence` / `decideLeave`
 *     与负责人同权）；
 *   · 每日 08:00 / 20:00 汇总邮件的收件人（`activity-digest.js` 按 `负责人账号ID` 归集）。
 *
 * 未列出的点位返回空串，由 `blood-source.js` 退回虚拟账号 `njutable-automation`：
 * 那是刻意留的空档，这类班次的待办不进本汇总，而是转平台超管兜底。
 *
 * 换人属于组织架构调整，改这张表需要发版。账号 ID 取自平台账号表（`ACC-…`），
 * 不是学号，也不是登录名。
 */
export const BLOOD_POINT_OWNERS = Object.freeze({
  '新街口中央': 'ACC-MV56DM2E-D28AD6', // 舒栎洁
  '仙林学则路': 'ACC-MV56DM2E-D28AD6', // 舒栎洁
  '新街口印象汇': 'ACC-MV535IPI-7154A2', // 房思源
  '浦口弘阳广场': 'ACC-MV535IPI-7154A2', // 房思源
});

/** 点位负责人；未配置时返回空串，由调用方决定兜底账号。 */
export function bloodPointOwner(location) {
  return BLOOD_POINT_OWNERS[location] || '';
}
