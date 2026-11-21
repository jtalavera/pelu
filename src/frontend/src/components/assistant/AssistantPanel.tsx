import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Heading } from "@design-system";
import { useAssistant } from "../../assistant/AssistantContext";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { TOPBAR_HEIGHT } from "../../layout/layoutConstants";
import { ACTION_BUTTON } from "../actionButtons";
import { InvoiceDetailModal } from "../InvoiceDetailModal";
import { AssistantComposer } from "./AssistantComposer";
import { AssistantMessageList } from "./AssistantMessageList";
import { BackIcon, CloseIcon, PlusIcon } from "./AssistantIcons";

/** Width of the docked panel on tablets and desktops. */
export const ASSISTANT_PANEL_WIDTH = 400;

/**
 * True when the open assistant takes space next to the content (desktop ≥ 1024 px): the screen
 * makes room for it instead of sitting under it.
 */
export function useAssistantDocked(): boolean {
  const { enabled, open } = useAssistant();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  return enabled && open && isDesktop;
}

/**
 * Side panel of the assistant, hanging under the top bar. A plain `<aside>`, not the design
 * system's modal `Drawer`: the person keeps using the screen next to it. ≥ 1024 px it docks and
 * pushes the content; 768–1023 px it overlays; below 768 px it takes the whole screen with a
 * «Volver» button.
 */
export function AssistantPanel() {
  const { t } = useTranslation();
  const a = useAssistant();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTabletUp = useMediaQuery("(min-width: 768px)");
  // The issued invoice opens in its own dialog (over the panel): «Ver factura», and «Compartir con
  // el cliente», which opens straight into its Compartir panel.
  const navigate = useNavigate();
  const [invoiceModal, setInvoiceModal] = useState<{ id: number; share: boolean } | null>(null);
  if (!a.enabled || !a.open) return null;

  const fullScreen = !isTabletUp;
  return (
    <aside
      id="assistant-panel"
      data-testid="assistant-panel"
      data-layout={fullScreen ? "fullscreen" : isDesktop ? "docked" : "overlay"}
      aria-label={t("femme.assistant.title")}
      className="fixed bottom-0 right-0 flex max-w-full flex-col border-l border-line bg-surface text-ink shadow-card"
      style={{
        top: TOPBAR_HEIGHT,
        width: fullScreen ? "100%" : ASSISTANT_PANEL_WIDTH,
        // Docked: under Toast (z-50) so notifications stay visible. Overlay / full screen: above
        // the bottom bar (z-80), below the top bar (z-100) and the navigation drawer (z-95).
        zIndex: isDesktop ? 40 : 85,
      }}
    >
      <header className="flex min-h-14 items-center gap-2 border-b border-line px-3">
        {fullScreen && (
          <Button
            type="button"
            variant="ghost"
            data-testid="assistant-back"
            className={`${ACTION_BUTTON} gap-1 px-2`}
            onClick={() => a.setOpen(false)}
          >
            <BackIcon />
            {t("femme.assistant.back")}
          </Button>
        )}
        <Heading as="h2" className="min-w-0 flex-1 truncate text-base">
          {t("femme.assistant.title")}
        </Heading>
        <Button
          type="button"
          variant="ghost"
          data-testid="assistant-new-conversation"
          className={`${ACTION_BUTTON} min-w-11 gap-1 px-2`}
          onClick={() => void a.newConversation()}
        >
          <PlusIcon />
          <span className={fullScreen ? "sr-only" : undefined}>
            {t("femme.assistant.newConversation")}
          </span>
        </Button>
        {!fullScreen && (
          <Button
            type="button"
            variant="ghost"
            data-testid="assistant-close"
            aria-label={t("femme.assistant.close")}
            className="min-h-11 min-w-11 px-2"
            onClick={() => a.setOpen(false)}
          >
            <CloseIcon />
          </Button>
        )}
      </header>
      <AssistantMessageList
        messages={a.messages}
        loadingHistory={a.loadingHistory}
        historyError={a.historyError}
        activeTool={a.activeTool}
        busy={a.busy}
        onSend={(text) => void a.send(text)}
        draftActions={{
          onConfirm: (id) => void a.confirmDraft(id),
          onDiscard: (id) => void a.discardDraft(id),
          onComplete: (id, patch) => void a.completeDraft(id, patch),
          onViewInvoice: (id) => setInvoiceModal({ id, share: false }),
          onShareInvoice: (id) => setInvoiceModal({ id, share: true }),
          // «Ver en la agenda»: the agenda opens on that day with the appointment's detail. On a
          // phone the panel covers the whole screen, so it steps aside; elsewhere it stays open.
          onViewAppointment: (id, date) => {
            navigate("/app/calendar", { state: { selectedDate: date, openAppointmentId: id } });
            if (fullScreen) a.setOpen(false);
          },
        }}
      />
      <AssistantComposer
        disabled={a.busy || a.loadingHistory}
        onSend={(text, inputMode) => void a.send(text, inputMode)}
      />
      {invoiceModal && (
        <InvoiceDetailModal
          invoiceId={invoiceModal.id}
          initialPanel={invoiceModal.share ? "share" : undefined}
          onClose={() => setInvoiceModal(null)}
        />
      )}
    </aside>
  );
}
