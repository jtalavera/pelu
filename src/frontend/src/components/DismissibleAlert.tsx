import type { ReactNode } from "react";
import { Alert } from "@design-system";

/**
 * An {@link Alert} the user can close with a «×» (44 px target, top right). The notice stays until
 * it is closed or the screen replaces it, so a message is never gone before it was read.
 */
export function DismissibleAlert({
  variant,
  title,
  children,
  onDismiss,
  closeLabel,
  "data-testid": testId,
  className,
}: {
  variant: "success" | "destructive" | "warning" | "info";
  title?: string;
  children?: ReactNode;
  onDismiss: () => void;
  /** Accessible name of the «×» button, already translated. */
  closeLabel: string;
  "data-testid"?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Alert variant={variant} title={title} data-testid={testId} className="pr-14">
        {children}
      </Alert>
      <button
        type="button"
        aria-label={closeLabel}
        data-testid={testId ? `${testId}-close` : undefined}
        onClick={onDismiss}
        className="absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-xl text-xl leading-none text-ink hover:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  );
}
