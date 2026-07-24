import { useEffect, useRef } from "react";
import { ACCESS_TOKEN_STORAGE_KEY, apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";

const IDLE_REFRESH_MS = 5 * 60 * 1000;

/**
 * Sliding session: periodically and on focus, refresh JWT while the tab is active (HU-01).
 * A 401 means the token is dead (expired past the refresh window, revoked, etc.) — stop
 * retrying and call onExpired instead of polling forever every IDLE_REFRESH_MS, which
 * previously kept waking the backend from a scaled-to-zero state indefinitely.
 */
export function useSessionRefresh(enabled: boolean, onExpired: () => void) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    if (!enabled) return;

    const stop = () => {
      window.removeEventListener("focus", onFocus);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };

    async function refresh() {
      const token = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      if (!token) return;
      try {
        const res = await fetch(`${apiBaseUrl()}/api/auth/refresh`, {
          method: "POST",
          headers: authHeaders({ json: false }),
        });
        if (res.status === 401) {
          sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
          stop();
          onExpiredRef.current();
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { accessToken: string };
        if (data.accessToken) {
          sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, data.accessToken);
        }
      } catch {
        /* ignore network errors */
      }
    }

    const onFocus = () => {
      void refresh();
    };

    window.addEventListener("focus", onFocus);
    timerRef.current = setInterval(() => void refresh(), IDLE_REFRESH_MS);
    void refresh();

    return stop;
  }, [enabled]);
}
