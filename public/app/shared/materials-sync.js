const CHANNEL = 'nju-materials-changes';

/** Refresh hints only: no account details or application data cross tabs. */
export function announceMaterialChange() {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: 'borrow-created' });
    channel.close();
  } catch { /* Focus refresh remains available when channels are unsupported. */ }
}

export function watchMaterialChanges(refresh) {
  let disposed = false, refreshing = false, channel;
  const reload = () => {
    if (disposed || refreshing || document.visibilityState !== 'visible') return;
    refreshing = true;
    Promise.resolve().then(refresh).catch(() => {}).finally(() => { refreshing = false; });
  };
  window.addEventListener('focus', reload);
  document.addEventListener('visibilitychange', reload);
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = event => { if (event.data?.type === 'borrow-created') reload(); };
  } catch { /* A browser without channels refreshes when the console is revisited. */ }
  return () => {
    disposed = true;
    window.removeEventListener('focus', reload);
    document.removeEventListener('visibilitychange', reload);
    channel?.close();
  };
}
