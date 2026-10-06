import { eventCategory } from './event-category.js';

/** Presentation groups only. Source rows remain independent booking places. */
export function activityPresentation(events) {
  const blood = events.filter(event => eventCategory(event) === 'blood');
  return {
    ordinary: events.filter(event => eventCategory(event) !== 'blood'),
    blood,
    summary: {
      shifts: blood.length,
      points: new Set(blood.map(event => event.location).filter(Boolean)).size,
      remaining: blood.reduce((sum, event) => sum + Math.max(0, Number(event.remaining) || 0), 0),
      dates: [...new Set(blood.map(event => (event.startAt || '').slice(0, 10)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort(),
    },
  };
}
