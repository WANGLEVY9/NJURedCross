// Labels use actual projected attendance records; missing evidence is never a text sign-in.
export function attendanceEvidenceState(registration, detail, blood = false) {
  if (registration['签到照片ID'] || detail?.hasPhoto || detail?.legacy?.some(record => record.photos?.length)) {
    return { label: '图片签到', text: '', hasPhoto: true };
  }
  const notes = [...new Set((detail?.legacy || []).map(record => record.note).filter(Boolean))];
  if (notes.length) return { label: '文字签到', text: notes.join('\n'), hasPhoto: false };
  if (detail?.verified) return { label: '现场核验', text: detail.verified.note || '已核验到场', hasPhoto: false };
  return { label: blood ? '待提交图片' : '待现场签到', text: '', hasPhoto: false };
}
