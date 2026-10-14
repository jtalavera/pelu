/**
 * HU-65: "Cerrar sesión en Stock también la cierra en Femme". Stock sends the user to
 * `/login?reason=stock_logout` in the Stock tab; that page broadcasts a logout so every open Femme
 * tab (the one Stock was opened from included) ends its session too.
 */
const CHANNEL = "femme-session";

type SessionMessage = { type: "logout"; reason: string };

export function broadcastLogout(reason: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ type: "logout", reason } satisfies SessionMessage);
  channel.close();
}

/** Subscribes to logouts broadcast by other tabs; returns the unsubscribe function. */
export function onBroadcastLogout(handler: (reason: string) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<SessionMessage>) => {
    if (event.data?.type === "logout") handler(event.data.reason);
  };
  return () => channel.close();
}
