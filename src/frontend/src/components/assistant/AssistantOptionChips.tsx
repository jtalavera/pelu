import { useTranslation } from "react-i18next";
import type { AssistantOptionsCard } from "../../assistant/AssistantContext";

/**
 * Tappable options (free times, a client…) the backend sent with an answer. Tapping one sends its
 * `value` as the person's own message, so the conversation reads naturally and the model gets the
 * ids it needs (tool results are not replayed between turns).
 */
export function AssistantOptionChips({
  card,
  disabled,
  onPick,
}: {
  card: AssistantOptionsCard;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`femme.assistant.options.${card.optionsKind}`, { defaultValue: "" });
  return (
    <div
      role="group"
      aria-label={label || undefined}
      data-testid="assistant-options"
      data-kind={card.optionsKind}
      className="flex max-w-[95%] flex-col gap-2"
    >
      {label && <span className="text-xs text-ink-2">{label}</span>}
      <div className="flex flex-wrap gap-2">
        {card.options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            data-testid="assistant-option"
            onClick={() => onPick(o.value)}
            className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-primary-lt disabled:opacity-60"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
