import { useTranslation } from "react-i18next";
import { useAssistant } from "../../assistant/AssistantContext";
import { SparklesIcon } from "./AssistantIcons";

/**
 * Topbar button that opens the assistant. Styled like its neighbours (bell, tour) with the topbar
 * colour variables; renders nothing unless the ASSISTANT_CHATBOT flag is on for this tenant.
 */
export function AssistantButton({ isPhone }: { isPhone: boolean }) {
  const { t } = useTranslation();
  const { enabled, open, toggle } = useAssistant();
  if (!enabled) return null;
  return (
    <button
      type="button"
      data-testid="topbar-assistant"
      aria-label={open ? t("femme.assistant.close") : t("femme.assistant.open")}
      aria-expanded={open}
      aria-controls="assistant-panel"
      title={t("femme.assistant.openWithShortcut")}
      onClick={toggle}
      style={{
        width: isPhone ? 44 : 32,
        height: isPhone ? 44 : 32,
        borderRadius: "var(--radius-pill)",
        background: open ? "var(--topbar-sel-fg, var(--topbar-ctl))" : "var(--topbar-ctl)",
        color: open ? "var(--topbar-bg)" : "var(--topbar-fg)",
        border: "1px solid transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <SparklesIcon />
    </button>
  );
}
