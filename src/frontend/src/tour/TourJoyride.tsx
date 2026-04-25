import { Joyride } from "react-joyride";
import { useTranslation } from "react-i18next";
import { useTourContext } from "./TourContext";

type TourJoyrideProps = {
  /** When false, the overlay never runs (e.g. guided tour feature flag off). */
  enabled?: boolean;
};

export function TourJoyride({ enabled = true }: TourJoyrideProps) {
  const { t } = useTranslation();
  const { run, steps, handleEvent } = useTourContext();

  if (!enabled || steps.length === 0) return null;

  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      scrollToFirstStep
      onEvent={handleEvent}
      locale={{
        back: t("femme.tour.controls.back"),
        close: t("femme.tour.controls.close"),
        last: t("femme.tour.controls.last"),
        next: t("femme.tour.controls.next"),
        skip: t("femme.tour.controls.skip"),
      }}
      options={{
        showProgress: true,
        buttons: ["back", "skip", "primary"],
        skipBeacon: true,
        primaryColor: "#e11d48",
        textColor: "#111827",
        overlayColor: "rgba(0,0,0,0.4)",
        zIndex: 10000,
        scrollOffset: 80,
      }}
      styles={{
        tooltip: {
          borderRadius: 12,
          padding: "20px 24px 18px",
          maxWidth: 340,
          backgroundColor: "#ffffff",
          boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        },
        tooltipTitle: {
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 8,
          color: "#111827",
        },
        tooltipContent: {
          fontSize: 13,
          lineHeight: 1.65,
          color: "#374151",
          padding: 0,
        },
        tooltipFooter: {
          marginTop: 14,
        },
        buttonPrimary: {
          borderRadius: 8,
          fontSize: 12,
          padding: "7px 18px",
          fontWeight: 500,
        },
        buttonBack: {
          fontSize: 12,
          padding: "7px 12px",
          color: "#6b7280",
        },
        buttonSkip: {
          fontSize: 11,
          color: "#9ca3af",
        },
      }}
    />
  );
}
