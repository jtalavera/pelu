import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Placement, Step } from "react-joyride";
import { useTourContext } from "./TourContext";

export type FemmeTourStepDef = {
  /** CSS selector using a data-tour attribute, e.g. `"[data-tour='dashboard-metrics']"` */
  target: string;
  titleKey: string;
  contentKey: string;
  placement?: Placement;
  /** Roles that should see this step. Omit to show to all roles. */
  roles?: Array<"ADMIN" | "PROFESSIONAL">;
};

function buildJoyrideSteps(
  defs: FemmeTourStepDef[],
  t: (key: string) => string,
  role?: string,
): Step[] {
  return defs
    .filter((d) => !d.roles || (role && d.roles.includes(role as "ADMIN" | "PROFESSIONAL")))
    .map((d) => ({
      target: d.target,
      title: t(d.titleKey),
      content: t(d.contentKey),
      placement: d.placement ?? "auto",
    }));
}

/**
 * Register a guided tour for the current page and auto-launch it on first visit.
 *
 * `stepDefs` MUST be a stable module-level constant (not inline) to avoid
 * re-registering the tour on every render.
 */
export function useTour(
  key: string,
  stepDefs: FemmeTourStepDef[],
  role?: string,
  enabled = true,
) {
  const { t, i18n } = useTranslation();
  const { registerTour, startTour, hasSeenTour, clearTour } = useTourContext();

  const lang = i18n.resolvedLanguage ?? "en";

  useEffect(() => {
    if (!enabled) {
      clearTour();
      return;
    }
    const steps = buildJoyrideSteps(stepDefs, t, role);
    registerTour(key, steps);

    if (!hasSeenTour(key)) {
      const timer = setTimeout(startTour, 700);
      return () => {
        clearTimeout(timer);
        clearTour();
      };
    }
    return () => {
      clearTour();
    };
    // stepDefs is intentionally excluded — it must be a stable module-level constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lang, role, enabled]);

  return { startTour };
}
