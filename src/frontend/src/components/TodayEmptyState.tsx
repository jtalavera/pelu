import { Button } from "@design-system";

/**
 * The empty state of the Panel principal's «Turnos de hoy» and «Fichas de servicio de hoy» cards: a short
 * message and one call-to-action, centred, with the same spacing and look in both so the two sections match.
 * The card around it has no padding of its own (`<Card className="p-0">`); this adds the spacing.
 */
export function TodayEmptyState({
  message,
  actionLabel,
  onAction,
  testId,
  actionTestId,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  testId: string;
  actionTestId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="h-3" aria-hidden="true" />
      <div className="flex flex-col items-center gap-3 px-5 pb-6 pt-4 text-center">
        <p className="text-ink-3">{message}</p>
        {onAction && actionLabel ? (
          <Button type="button" variant="primary" className="min-h-11 sm:h-11 sm:min-h-11" data-testid={actionTestId} onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
