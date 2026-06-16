import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { STATUS, type EventData, type Step } from "react-joyride";
import { femmeJson, femmePostJson } from "../api/femmeClient";

interface TourContextValue {
  run: boolean;
  steps: Step[];
  tourKey: string;
  seenVersion: number;
  startTour: () => void;
  stopTour: () => void;
  registerTour: (key: string, steps: Step[]) => void;
  clearTour: () => void;
  handleEvent: (data: EventData) => void;
  hasSeenTour: (key: string) => boolean;
  /** Call once after login to sync seen state from backend. */
  syncFromBackend: () => Promise<void>;
}

const TourContext = createContext<TourContextValue | null>(null);

const STORAGE_PREFIX = "femme.tour.seen.";

export function TourProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tourKey, setTourKey] = useState("");
  const [seenVersion, setSeenVersion] = useState(0);
  const tourKeyRef = useRef(tourKey);
  tourKeyRef.current = tourKey;

  const startTour = useCallback(() => setRun(true), []);
  const stopTour = useCallback(() => setRun(false), []);

  const registerTour = useCallback((key: string, newSteps: Step[]) => {
    setTourKey(key);
    setSteps(newSteps);
    setRun(false);
  }, []);

  const clearTour = useCallback(() => {
    setTourKey("");
    setSteps([]);
    setRun(false);
  }, []);

  const hasSeenTour = useCallback(
    (key: string) => localStorage.getItem(`${STORAGE_PREFIX}${key}`) === "true",
    // seenVersion in deps so callers re-evaluate after a tour completes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seenVersion],
  );

  const handleEvent = useCallback((data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      setRun(false);
      const key = tourKeyRef.current;
      if (key) {
        localStorage.setItem(`${STORAGE_PREFIX}${key}`, "true");
        setSeenVersion((v) => v + 1);
        // Persist to backend (fire-and-forget; localStorage is the offline cache)
        femmePostJson<void>(`/api/me/tour-state/${encodeURIComponent(key)}`, {}).catch(
          () => undefined,
        );
      }
    }
  }, []);

  const syncFromBackend = useCallback(async () => {
    try {
      const seen = await femmeJson<{ tourKey: string }[]>("/api/me/tour-state");
      seen.forEach(({ tourKey: k }) => {
        localStorage.setItem(`${STORAGE_PREFIX}${k}`, "true");
      });
      setSeenVersion((v) => v + 1);
    } catch {
      // Non-critical: fall back to localStorage-only state
    }
  }, []);

  // Sync from backend once on provider mount (fires after login when app re-renders)
  useEffect(() => {
    syncFromBackend();
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TourContext.Provider
      value={{
        run,
        steps,
        tourKey,
        seenVersion,
        startTour,
        stopTour,
        registerTour,
        clearTour,
        handleEvent,
        hasSeenTour,
        syncFromBackend,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTourContext() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTourContext must be used within TourProvider");
  return ctx;
}
