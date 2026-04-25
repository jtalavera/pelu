import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { STATUS, type EventData, type Step } from "react-joyride";

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
}

const TourContext = createContext<TourContextValue | null>(null);

const STORAGE_PREFIX = "femme.tour.seen.";

export function TourProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [tourKey, setTourKey] = useState("");
  const [seenVersion, setSeenVersion] = useState(0);

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

  const handleEvent = useCallback(
    (data: EventData) => {
      if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
        setRun(false);
        if (tourKey) {
          localStorage.setItem(`${STORAGE_PREFIX}${tourKey}`, "true");
          setSeenVersion((v) => v + 1);
        }
      }
    },
    [tourKey],
  );

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
