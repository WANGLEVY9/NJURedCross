/** Do not let upstream row order decide between equal issuance timestamps. */
export function latestChallenge(rows, purpose) {
  const candidates=rows.filter(row=>row['用途']===purpose);
  const timestamps=candidates.map(row=>Date.parse(row['创建时间']));
  if(timestamps.some((time,index)=>!Number.isFinite(time)&&candidates[index]['状态']==='待使用'))return {ambiguous:true};
  const newest=Math.max(...timestamps.filter(Number.isFinite));
  const group=candidates.filter((row,index)=>timestamps[index]===newest);
  if(group.length<=1)return {row:group[0]};
  const pending=group.filter(row=>row['状态']==='待使用');
  // Issuance invalidates its predecessor. A single pending row in a tied group
  // is unambiguous; two pending rows cannot be authenticated by guessing order.
  return pending.length===1?{row:pending[0]}:{ambiguous:true};
}
