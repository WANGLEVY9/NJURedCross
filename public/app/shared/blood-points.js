/** Supported blood-vehicle sites, shared by roster validation and calendar filters. */
export const BLOOD_POINTS = Object.freeze(['新街口中央', '新街口印象汇', '仙林学则路', '浦口弘阳广场']);

/** 固定点位顺序（新街口中央-印象汇-学则路-浦口）；未知点位排在最后。 */
export function bloodPointRank(location) {
  const index = BLOOD_POINTS.indexOf(location);
  return index === -1 ? BLOOD_POINTS.length : index;
}

/** 同一天的班次先按点位、再按时间排列，方便志愿者按地点查看。 */
export function bloodSlotCompare(a, b) {
  return bloodPointRank(a.location) - bloodPointRank(b.location)
    || String(a.slot || '').localeCompare(String(b.slot || ''))
    || String(a.location || '').localeCompare(String(b.location || ''));
}
