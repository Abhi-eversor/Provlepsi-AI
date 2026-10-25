export const SESSION_EVENT_KEY = 'provlepsi-session-event-v2';
export const SESSION_CHANNEL = 'provlepsi-session-v2';
interface ScopedSessionEvent {
  accountId: string;
  phase: 'signout-start' | 'signout-complete' | 'project-delete';
  projectId?: string;
  sender: string;
  id: string;
}
export type AccountSessionEvent = ScopedSessionEvent | { phase: 'identity-change'; sender: string; id: string };
export function isAccountSessionEvent(value: unknown): value is AccountSessionEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as ScopedSessionEvent;
  if ((event.phase as string) === 'identity-change') return typeof event.sender === 'string' && typeof event.id === 'string';
  return typeof event.accountId === 'string' && /^[1-9]\d*$/.test(event.accountId) && typeof event.sender === 'string' && typeof event.id === 'string'
    && ['signout-start', 'signout-complete', 'project-delete'].includes(event.phase)
    && (event.phase !== 'project-delete' || (typeof event.projectId === 'string' && /^[a-f\d-]{36}$/i.test(event.projectId)));
}
let clientId: string | undefined;
export function getSessionClientId() { return clientId ??= crypto.randomUUID(); }
function broadcast(message: AccountSessionEvent) {
  // Storage events provide a fallback when BroadcastChannel is unavailable.
  try {
    localStorage.setItem(SESSION_EVENT_KEY, JSON.stringify(message));
    localStorage.removeItem(SESSION_EVENT_KEY);
  } catch { /* The channel may still work. */ }
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.postMessage(message);
    channel.close();
  }
}
export function broadcastSignOut(accountId: string, sender: string, phase: 'signout-start' | 'signout-complete') {
  broadcast({ accountId, sender, phase, id: crypto.randomUUID() });
}
export function broadcastProjectDeletion(accountId: string, projectId: string) {
  broadcast({ accountId, projectId, sender: getSessionClientId(), phase: 'project-delete', id: crypto.randomUUID() });
}
export function broadcastIdentityChange() {
  broadcast({ phase: 'identity-change', sender: getSessionClientId(), id: crypto.randomUUID() });
}
