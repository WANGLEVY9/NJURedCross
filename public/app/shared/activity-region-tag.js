import {h} from '../core/dom.js';
import {activityRegion} from './activity-taxonomy.js';

function settingsOf(record) {
  const raw = record?.['报名页配置'];
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

/** Reads the same persisted region used by the portal, including legacy row fields. */
export function isSuzhouActivity(record) {
  const source = record && typeof record === 'object' ? record : {region: String(record || '')};
  const settings = settingsOf(source);
  const explicit = source.content?.region ?? source.region ?? source['活动地区'] ?? settings.region;
  const value = String(explicit || '').trim();
  if (/苏州/.test(value)) return true;
  if (/南京/.test(value)) return false;
  return activityRegion({
    region: value,
    campus: source.campus ?? source['校区'],
    location: source.location ?? source['地点'],
    center: source.center ?? source['组织类别'] ?? settings.center,
    type: source.type ?? source['活动类别'],
    activityCategory: source.activityCategory,
  }) === 'suzhou';
}

export function activityRegionTag(record) {
  return isSuzhouActivity(record)
    ? h('span',{class:'activity-region-tag',text:'苏州'})
    : null;
}

/** Keep the region with the final two title characters when a line wraps. */
export function activityRegionTitle(name, record) {
  const title=String(name||'');
  if(!isSuzhouActivity(record))return title;
  const chars=Array.from(title),tail=chars.splice(-2).join('');
  return h('span',{class:'activity-region-title'},chars.join(''),h('span',{class:'activity-region-title__tail'},tail,activityRegionTag(record)));
}
