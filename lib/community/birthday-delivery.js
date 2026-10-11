/** Resume a partially persisted birthday batch without repeating completed items. */
export function birthdayDeliveryQuota(rows, { studentId, day, year, earned, doneStatus }) {
  const completed = rows.filter(row => String(row['收件人学号'] || '') === studentId
    && String(row['触发日期'] || '') === day && String(row['触发年份'] || '') === year
    && String(row['站内状态'] || '') === doneStatus
    && ['一对一匹配', '仓库抽取'].includes(String(row['来源'] || '')));
  return {
    remaining: Math.max(0, Math.max(1, earned) - completed.length),
    completedSubmissionIds: new Set(completed.map(row => String(row['投稿ID'] || ''))),
  };
}
