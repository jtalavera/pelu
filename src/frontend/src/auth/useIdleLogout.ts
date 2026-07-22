import { useEffect, useRef } from "react";

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

/** Real DOM interaction only; deliberately excludes anything fetch/timer-driven. */
const ACTIVITY_EVENTS = ["mousedown", "mousemove", "keydown", "wheel", "touchstart", "scroll", "click"] as const;

/** Avoid rescheduling the timeout on every single mousemove/scroll tick. */
const ACTIVITY_THROTTLE_MS = 1000;

/**
 * Logs the user out after `timeoutMs` of no genuine DOM interaction (issue #115).
 * Must NOT be reset by fetch/setInterval activity (useSessionRefresh, dashboard polling).
 */
export function useIdleLogout(enabled: boolean, onIdle: () => void, timeoutMs: number = IDLE_TIMEOUT_MS) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    let lastReset = 0;

    function scheduleTimeout() {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    }

    function handleActivity() {
      const now = Date.now();
      if (now - lastReset < ACTIVITY_THROTTLE_MS) return;
      lastReset = now;
      scheduleTimeout();
    }

    scheduleTimeout();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, handleActivity, { passive: true });

    return () => {
      clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, handleActivity);
    };
  }, [enabled, timeoutMs]);
}
