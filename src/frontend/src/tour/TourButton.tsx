import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTourContext } from "./TourContext";

const STYLE_ID = "femme-tour-fab-keyframes";

function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes femme-tour-pulse {
      0%   { box-shadow: 0 4px 14px rgba(225,29,72,.35), 0 0 0 0 rgba(225,29,72,.45); }
      70%  { box-shadow: 0 4px 14px rgba(225,29,72,.35), 0 0 0 12px rgba(225,29,72,0); }
      100% { box-shadow: 0 4px 14px rgba(225,29,72,.35), 0 0 0 0 rgba(225,29,72,0); }
    }
    .femme-tour-fab-pulse {
      animation: femme-tour-pulse 2.2s ease-out infinite;
    }
  `;
  document.head.appendChild(el);
}

/**
 * Floating action button that lets the user (re-)start the guided tour for the
 * current page. Pulses when the tour has not been seen yet on this page.
 *
 * Rendered inside AppShell so it only appears on authenticated screens.
 */
export function TourButton() {
  const { t } = useTranslation();
  const { startTour, tourKey, seenVersion, hasSeenTour } = useTourContext();
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  useEffect(() => {
    setIsPulsing(!!tourKey && !hasSeenTour(tourKey));
  }, [tourKey, seenVersion, hasSeenTour]);

  if (!tourKey) return null;

  return (
    <button
      type="button"
      onClick={startTour}
      aria-label={t("femme.tour.helpButton.aria")}
      title={t("femme.tour.helpButton.aria")}
      className={isPulsing ? "femme-tour-fab-pulse" : undefined}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 54,
        height: 54,
        borderRadius: "50%",
        background: "var(--color-rose)",
        color: "var(--color-on-primary)",
        border: "2px solid rgba(255,255,255,0.25)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 1,
        boxShadow: "0 4px 14px rgba(225,29,72,.35)",
        zIndex: 998,
        fontFamily: "inherit",
        lineHeight: 1,
        transition: "transform 0.15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "";
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "Georgia, 'Times New Roman', serif",
          display: "block",
          marginTop: -1,
          color: "var(--color-on-primary)",
        }}
      >
        ?
      </span>
      <span
        style={{
          fontSize: 8,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-on-primary)",
        }}
      >
        {t("femme.tour.helpButton.label")}
      </span>
    </button>
  );
}
