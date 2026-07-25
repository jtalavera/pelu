import { useEffect } from "react";
import { APP_VERSION } from "../lib/appVersion";

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000; // matches useSessionRefresh's cadence

/**
 * Hotfix for the stale-tab incident: a browser tab can keep an old JS bundle running in
 * memory indefinitely (e.g. left open over a weekend). Periodically, and on window focus,
 * check whether a newer build has been deployed and reload immediately if so — this is
 * the *only* way an already-running old bundle can pick up any later fix (401-retry-loop
 * or otherwise). Deliberately unconditional (mounted in App.tsx) — a tab stuck on /login is
 * just as much at risk as one stuck in the authenticated app shell.
 */
export function useVersionCheck(): void {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { version?: string };
        if (data.version && data.version !== APP_VERSION) {
          window.location.reload();
        }
      } catch {
        /* network hiccup / offline — ignore, retry next interval or focus */
      }
    }

    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    const id = setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, []);
}
