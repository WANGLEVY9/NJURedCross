/** Describe visible changes only; opponent hands are never included. */
export function tableTransition(previous, next) {
  if (!next || next.phase !== 'playing') return [];
  if (!previous || previous.phase !== 'playing' || previous.roomId !== next.roomId || previous.round !== next.round) return [{ type: 'deal' }];
  const changes = [];
  if (next.drawPileCount > previous.drawPileCount && next.discardCount < previous.discardCount) changes.push({ type: 'shuffle' });
  if (next.top?.id && next.top.id !== previous.top?.id) changes.push({ type: 'play', seat: previous.turn, image: next.top.image });
  for (let seat = 0; seat < (next.seats || []).length; seat += 1) {
    if ((next.seats[seat]?.handCount || 0) > (previous.seats?.[seat]?.handCount || 0)) changes.push({ type: 'draw', seat });
  }
  return changes;
}

/** Animate a temporary visual layer; it never controls or changes game state. */
export function animateTable(board, transitions, cardBack, imageUrl) {
  if (!board || !transitions.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Element.prototype.animate) return;
  const deck = board.querySelector('.uno-pile--draw .uno-pile__img');
  const discard = board.querySelector('.uno-pile--discard .uno-card');
  if (!deck || !discard) return;
  const base = board.getBoundingClientRect();
  const point = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top }; };
  const source = point(deck), target = point(discard);
  const layer = document.createElement('div'); layer.className = 'uno-flight-layer'; layer.setAttribute('aria-hidden', 'true'); board.append(layer);
  const seatPoint = (index) => { const node = board.querySelector(`[data-uno-seat-position="${index}"]`); return node ? point(node) : source; };
  const fly = (from, to, src, delay = 0) => {
    const card = document.createElement('img'); card.className = 'uno-flight'; card.src = src; card.alt = '';
    card.style.left = `${from.x - 23}px`; card.style.top = `${from.y - 35}px`; layer.append(card);
    const animation = card.animate([
      { transform: 'translate(0,0) rotate(-8deg) scale(.72)', opacity: 0 },
      { opacity: 1, offset: .16 },
      { transform: `translate(${to.x - from.x}px,${to.y - from.y}px) rotate(4deg) scale(.95)`, opacity: 0.9 },
    ], { duration: 470, delay, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
    animation.finished.catch(() => {}).finally(() => card.remove());
  };
  for (const change of transitions) {
    if (change.type === 'deal') {
      for (let i = 0; i < 4; i += 1) fly(source, { x: source.x + (i % 2 ? 28 : -28), y: source.y - 5 }, cardBack, i * 65);
      for (let seat = 0; seat < 4; seat += 1) fly(source, seatPoint(seat), cardBack, 360 + seat * 85);
    } else if (change.type === 'shuffle') {
      for (let i = 0; i < 3; i += 1) fly(target, source, cardBack, i * 90);
    } else if (change.type === 'play') fly(seatPoint(change.seat), target, imageUrl(change.image));
    else if (change.type === 'draw') fly(source, seatPoint(change.seat), cardBack);
  }
  window.setTimeout(() => layer.remove(), 1500);
}
