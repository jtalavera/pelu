import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { Button } from "./Button";

export type DrawerProps = {
  open: boolean;
  onClose?: () => void;
  title?: string;
  children: ReactNode;
  side?: "left" | "right";
  className?: string;
  closeLabel?: string;
};

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right",
  className,
  closeLabel = "Close panel",
}: DrawerProps) {
  const titleId = useId();

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
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        side === "right" ? "justify-end" : "justify-start",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] dark:bg-black/60"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <aside
        className={cn(
          "relative z-10 flex h-full w-full max-w-md flex-col border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900",
          side === "right" ? "border-l" : "border-r",
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          {title ? (
            <h2
              id={titleId}
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
          ) : (
            <span />
          )}
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-slate-500 dark:text-slate-400"
              onClick={onClose}
              aria-label={closeLabel}
            >
              ×
            </Button>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
