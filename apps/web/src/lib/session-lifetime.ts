const eventName = 'agentfit-session-ended';
export function notifySessionEnded(broadcast = true) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(eventName));
  if (broadcast && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('agentfit-session'); channel.postMessage('ENDED'); channel.close();
  }
}
export function subscribeSessionEnded(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
export function sessionRequestSignal(external?: AbortSignal | null, protectedRequest = true) {
  const controller = new AbortController(); const abort = () => controller.abort();
  const unsubscribe = protectedRequest ? subscribeSessionEnded(abort) : () => {};
  if (external?.aborted) abort(); else external?.addEventListener('abort', abort, { once: true });
  return { signal: controller.signal, dispose() { unsubscribe(); external?.removeEventListener('abort', abort); } };
}
