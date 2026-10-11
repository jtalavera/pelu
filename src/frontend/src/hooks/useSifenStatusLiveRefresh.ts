import { useEffect, useRef } from "react";

/** How often an invoice table re-reads its rows while one of them is still in flight to SIFEN. */
export const SIFEN_LIVE_REFRESH_MS = 2000;

/**
 * SIFEN statuses the backend can still change on its own, with no user action: "En cola" (waiting
 * for the queue consumer) and "Pendiente de verificación" (sent, or sent in a lote, and waiting
 * for SIFEN's verdict — the backend polls consulta-lote every second at first).
 */
export function isSifenStatusInFlight(status?: string | null): boolean {
  return status === "QUEUED" || status === "PENDING_VERIFICATION";
}

/**
 * Silently re-runs {@code refresh} every {@link SIFEN_LIVE_REFRESH_MS} while {@code active} (some
 * visible row is still in flight to SIFEN), so the table shows the new status as soon as the
 * backend records it. Pauses while the browser tab is hidden and refreshes once on coming back.
 */
export function useSifenStatusLiveRefresh(active: boolean, refresh: () => void): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    const id = window.setInterval(tick, SIFEN_LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active]);
}
