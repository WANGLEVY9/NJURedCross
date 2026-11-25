/** Combine abort signals without requiring the newer AbortSignal.any API. */
export function combineSignals(signals) {
  const inputs = signals.filter(Boolean);
  if (!inputs.length) return new AbortController().signal;
  if (inputs.length === 1) return inputs[0];
  if (typeof AbortSignal?.any === 'function') return AbortSignal.any(inputs);
  const controller = new AbortController();
  const listeners = [];
  const cancel = () => {
    const aborted = inputs.find(signal => signal.aborted);
    if (aborted && !controller.signal.aborted) controller.abort(aborted.reason);
    for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener);
  };
  for (const signal of inputs) {
    if (signal.aborted) { cancel(); break; }
    const listener = () => cancel();
    listeners.push([signal, listener]);
    signal.addEventListener('abort', listener, { once: true });
  }
  return controller.signal;
}
