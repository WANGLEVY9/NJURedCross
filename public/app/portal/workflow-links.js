/** Resolve parent deep links using only already-public child sessions. */
export function workflowGroupFor(events,eventId,selectedId){
  return events.find(e=>e.id===eventId||e.id===selectedId||Boolean(eventId)&&e.parentEventId===eventId)?.ordinary?.groupId;
}
/** Keep blood booking in its weekly calendar, including across authentication. */
export function workflowEventPath(event, week) {
  const query = new URLSearchParams();
  if (event.blood) {
    query.set('type', 'blood');
    query.set('slot', event.id);
    if (week) query.set('week', week);
  } else query.set('event', event.id);
  return `/workflow-events?${query}`;
}
