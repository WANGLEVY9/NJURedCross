import { eventCategory } from './event-category.js';

/** The blood programme advertises the full week after next in Beijing time. */
export function bloodRegistrationWeek(now = Date.now()) {
  const today = new Date(new Date(now).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7 + 14);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

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
