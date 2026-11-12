import { useEffect, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

const variants = {
  default:
    "border-line bg-surface text-ink",
  success:
    "border-success bg-success-lt text-success",
  error:
    "border-danger bg-danger-lt text-danger",
} as const;

export type ToastProps = HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  variant?: keyof typeof variants;
  duration?: number;
  children: ReactNode;
};

/**
 * Fixed snackbar-style region. When `duration` &gt; 0, calls `onOpenChange(false)` after that many ms.
 */
export function Toast({
  open,
  onOpenChange,
  variant = "default",
  duration = 0,
  className,
  children,
  ...props
}: ToastProps) {
  useEffect(() => {
    if (!open || !duration || !onOpenChange) return;
    const t = window.setTimeout(() => onOpenChange(false), duration);
    return () => window.clearTimeout(t);
  }, [open, duration, onOpenChange]);

  if (!open) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:justify-end sm:p-6"
      aria-live="polite"
    >
      <div
        role="status"
        className={cn(
          "pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg",
          variants[variant],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
