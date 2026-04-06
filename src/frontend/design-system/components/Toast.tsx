import { useEffect, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

const variants = {
  default:
    "border-slate-200 bg-white text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100",
  error:
    "border-red-200 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100",
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
          "pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg",
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
