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
