export function createScrollState() {
  const positions = new Map();
  let cancelRestore = () => {};

  function keyOf(context) {
    return `${context.path}?${context.query.toString()}`;
  }

  return {
    remember(context, scroller) {
      cancelRestore();
      if (!context || !scroller) return;

      const key = keyOf(context);
      positions.delete(key);
      positions.set(key, {
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
      });

      while (positions.size > 60) {
        positions.delete(positions.keys().next().value);
      }
    },

    restore(context, scroller) {
      cancelRestore();
      const saved = positions.get(keyOf(context));
      if (!saved || !scroller) return;

      let stopped = false;
      let frame = null;
      let timeout;
      const observer = new MutationObserver(schedule);

      function stop() {
        if (stopped) return;
        stopped = true;
        observer.disconnect();
        cancelAnimationFrame(frame);
        clearTimeout(timeout);
        scroller.removeEventListener('wheel', stop);
        scroller.removeEventListener('touchstart', stop);
        scroller.removeEventListener('pointerdown', stop);
        scroller.removeEventListener('keydown', stop);
      }

      function attempt() {
        frame = null;
        if (stopped) return;

        const maximum = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight,
        );
        if (maximum < saved.top) return;

        scroller.scrollTo({
          top: saved.top,
          left: saved.left,
          behavior: 'instant',
        });
        stop();
      }

      function schedule() {
        if (!stopped && frame === null) {
          frame = requestAnimationFrame(attempt);
        }
      }

      observer.observe(scroller, { childList: true, subtree: true });
      scroller.addEventListener('wheel', stop, { passive: true });
      scroller.addEventListener('touchstart', stop, { passive: true });
      scroller.addEventListener('pointerdown', stop, { passive: true });
      scroller.addEventListener('keydown', stop);
      timeout = setTimeout(stop, 10000);
      cancelRestore = stop;
      schedule();
    },

    clear() {
      cancelRestore();
      positions.clear();
    },
  };
}