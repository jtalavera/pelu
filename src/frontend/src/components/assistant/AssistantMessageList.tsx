import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Heading, Spinner, Text } from "@design-system";
import { translateApiError } from "../../api/parseApiErrorMessage";
import type { AssistantUiMessage } from "../../assistant/AssistantContext";
import { InvoiceDraftCard } from "./InvoiceDraftCard";

const SUGGESTIONS = ["appointmentsToday", "services", "professionals"] as const;

function TypingDots({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

function Welcome({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-testid="assistant-welcome" className="space-y-3 py-2">
      <Heading as="h3" className="text-base">
        {t("femme.assistant.welcomeTitle")}
      </Heading>
      <Text variant="muted">{t("femme.assistant.welcomeBody")}</Text>
      <Text variant="label">{t("femme.assistant.suggestionsLabel")}</Text>
      <div className="flex flex-col items-start gap-2">
        {SUGGESTIONS.map((key) => {
          const label = t(`femme.assistant.suggestions.${key}`);
          return (
            <button
              key={key}
              type="button"
              data-testid="assistant-suggestion"
              disabled={disabled}
              onClick={() => onPick(label)}
              className="min-h-11 max-w-full rounded-card border border-line bg-surface px-3 py-2 text-left text-sm text-ink hover:bg-primary-lt disabled:opacity-60"
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The conversation: bubbles, a typing / «Buscando clientes…» indicator while the assistant works,
 * errors in the bubble that failed, and the welcome with suggestions when it is still empty.
 */
export function AssistantMessageList({
  messages,
  loadingHistory,
  historyError,
  activeTool,
  busy,
  onSend,
  draftActions,
}: {
  messages: AssistantUiMessage[];
  loadingHistory: boolean;
  historyError: Error | null;
  activeTool: string | null;
  busy: boolean;
  onSend: (text: string) => void;
  /** What the cards' buttons do (confirm, discard, complete, open the invoice). */
  draftActions: {
    onConfirm: (id: string) => void;
    onDiscard: (id: string) => void;
    onComplete: (
      id: string,
      patch: { paymentMethod?: string; cardBrand?: string; email?: string },
    ) => void;
    onViewInvoice: (invoiceId: number) => void;
    onShareInvoice: (invoiceId: number) => void;
  };
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeTool, loadingHistory]);

  const toolLabel = activeTool
    ? t(`femme.assistant.tool.${activeTool}`, { defaultValue: t("femme.assistant.tool.generic") })
    : null;

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-label={t("femme.assistant.conversationLabel")}
      data-testid="assistant-messages"
      className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4"
    >
      {loadingHistory && (
        <div className="flex items-center gap-2 text-ink-2" data-testid="assistant-loading">
          <Spinner size="sm" />
          <Text variant="muted">{t("femme.assistant.loadingHistory")}</Text>
        </div>
      )}
      {historyError && (
        <Alert variant="destructive" data-testid="assistant-history-error">
          {translateApiError(historyError, t)}
        </Alert>
      )}
      {!loadingHistory && !historyError && messages.length === 0 && (
        <Welcome onPick={onSend} disabled={busy} />
      )}
      {messages.map((m) => {
        const isUser = m.role === "USER";
        const waiting = m.streaming && m.content === "" && !m.error;
        return (
          <div
            key={m.key}
            data-testid="assistant-message"
            data-role={m.role}
            className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
          >
            {(m.content !== "" || waiting) && (
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-card px-3 py-2 text-sm ${
                  isUser
                    ? "bg-primary text-primary-fg"
                    : "border border-line bg-page text-ink"
                }`}
              >
                <span className="sr-only">
                  {isUser ? t("femme.assistant.youSaid") : t("femme.assistant.assistantSaid")}:{" "}
                </span>
                {waiting ? (
                  toolLabel ? (
                    <span data-testid="assistant-tool-status" className="text-ink-2">
                      {toolLabel}
                    </span>
                  ) : (
                    <TypingDots label={t("femme.assistant.typing")} />
                  )
                ) : (
                  m.content
                )}
              </div>
            )}
            {m.streaming && m.content !== "" && toolLabel && (
              <span data-testid="assistant-tool-status" className="text-xs text-ink-2">
                {toolLabel}
              </span>
            )}
            {m.cards?.map((card) => (
              <InvoiceDraftCard key={card.draft.id} card={card} {...draftActions} />
            ))}
            {m.error && (
              <Alert variant="destructive" data-testid="assistant-error" className="max-w-[95%]">
                {translateApiError(m.error, t)}
              </Alert>
            )}
          </div>
        );
      })}
    </div>
  );
}
