import { linkedRowIds } from './volunteer-workflow.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const departments = new Map([
  ['主席团 & 指导组', '主席团 / 指导组'], ['综事中心主任团', '综事中心'], ['生命中心主任团', '生命中心'],
  ['博爱中心主任团', '博爱中心'], ['工作组主任团', '工作组'], ['博爱', '博爱中心'], ['生命', '生命中心'],
  ['综事', '综事中心'], ['苏州', '苏州'],
]);

export function memberContext(registrations, profiles) {
  return registrations.map(registration => {
    const candidates = profiles.filter(p => text(p['学号']) && text(p['学号']) === registration['学号']);
    const profile = candidates.length === 1 && text(candidates[0]['姓名']) === registration['姓名'] ? candidates[0] : null;
    const department = text(profile?.['部门']);
    return { id: registration._id, center: departments.get(department) || '', department,
      membership: departments.has(department) ? 'member' : department === '志愿者' ? 'volunteer' : 'unknown',
      certificate: text(profile?.['急救证']) };
  });
}

export function attendanceContext(registration, event, checkins, legacyRegistrations, legacyCheckins) {
  const warnings = [];
  const own = checkins.filter(c => c._id === registration['签到行ID'] && c['报名行ID'] === registration._id
    && c['活动ID'] === registration['活动ID'] && c['账号ID'] === registration['账号ID']
    && c['学号'] === registration['学号'] && c['姓名'] === registration['姓名']);
  if (registration['签到行ID'] && own.length !== 1) warnings.push('网站签到关联不一致，请核对后再确认。');
  // Exact identity and session matching only; matching names alone is never evidence.
  const matches = legacyRegistrations.filter(r => ['姓名', '学号', '报名时段', '岗位'].every(key => text(r[key]) === text(registration[key]))
    && text(r['学号']) && text(r['活动名称']) === event['活动名称']
    && text(r['报名日期']).slice(0, 10) === text(registration['报名日期']).slice(0, 10));
  const records = [];
  if (matches.length > 1) warnings.push('旧表有多条相同场次报名，暂不自动关联，请在原表核对。');
  if (matches.length === 1) {
    const source = matches[0];
    for (const id of linkedRowIds(source['签到表'])) {
      const candidates = legacyCheckins.filter(c => c._id === id && c['学号'] === registration['学号'] && c['姓名'] === registration['姓名']
        && linkedRowIds(c['活动名称']).includes(source._id));
      if (candidates.length !== 1) { warnings.push('旧表签到关联缺失或身份不一致，请核对原表。'); continue; }
      const row = candidates[0];
      const photos = (Array.isArray(row['现场照片（需体现日期时间）']) ? row['现场照片（需体现日期时间）'] : [])
        .map(photo => typeof photo === 'string' ? photo : photo?.url).filter(url => {
          try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'table.nju.edu.cn' && !parsed.username && !parsed.password; } catch { return false; }
        });
      records.push({ time: text(row['活动时间']), submittedAt: text(row['创建时间']), note: text(row['备注']), status: text(row['已核对并录入']), photos });
    }
  }
  return { name: registration['姓名'], studentId: registration['学号'], submittedAt: registration['签到提交时间'] || '',
    hasPhoto: Boolean(registration['签到照片ID']), verified: own.length === 1 ? {
      by: own[0]['核验人'], at: own[0]['活动时间'], note: own[0]['核验说明'],
    } : null, legacy: records, warnings };
}
