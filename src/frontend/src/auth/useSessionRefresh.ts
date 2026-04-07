import { useEffect, useRef } from "react";
import { ACCESS_TOKEN_STORAGE_KEY, apiBaseUrl } from "../api/baseUrl";
import { authHeaders } from "../api/authHeaders";

const IDLE_REFRESH_MS = 5 * 60 * 1000;

/**
 * Sliding session: periodically and on focus, refresh JWT while the tab is active (HU-01).
 */
export function useSessionRefresh(enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const refresh = async () => {
      const token = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
      if (!token) return;
      try {
        const res = await fetch(`${apiBaseUrl()}/api/auth/refresh`, {
          method: "POST",
          headers: authHeaders({ json: false }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { accessToken: string };
        if (data.accessToken) {
          sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, data.accessToken);
        }
      } catch {
        /* ignore network errors */
      }
    };

    const onFocus = () => {
      void refresh();
    };

    window.addEventListener("focus", onFocus);
    timerRef.current = setInterval(() => void refresh(), IDLE_REFRESH_MS);
    void refresh();

    return () => {
      window.removeEventListener("focus", onFocus);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled]);
}
