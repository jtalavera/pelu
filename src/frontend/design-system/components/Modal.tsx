import { useEffect, useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export type ModalProps = {
  open: boolean;
  onClose?: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-tinta/40 backdrop-blur-[1px]"
        aria-label={t("designSystem.modal.closeDialog")}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col rounded-card border border-line bg-surface shadow-xl",
          "max-h-[calc(100dvh-2rem)]",
          className,
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 space-y-1">
            {title ? (
              <h2
                id={titleId}
                className="font-heading text-lg font-bold text-ink"
              >
                {title}
              </h2>
            ) : null}
            {description ? (
              <p
                id={descId}
                className="text-sm text-ink-3"
              >
                {description}
              </p>
            ) : null}
          </div>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-ink-3"
              onClick={onClose}
              aria-label={t("designSystem.modal.close")}
            >
              ×
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-line px-6 py-4 sm:flex-row sm:justify-end sm:gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
